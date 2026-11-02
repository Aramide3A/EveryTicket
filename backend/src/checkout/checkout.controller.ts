import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withDatabase } from '../persistence/database-operation.js';
import { createCheckoutOrder } from './checkout-order.js';
import { quoteCheckout } from './checkout-quote-service.js';
import { getCustomerOrderStatus } from './order-status.js';
import { initializePayment } from '../payments/payment-lifecycle.js';
import { createPaystackGateway } from '../payments/paystack-gateway.js';
import { guestCheckoutProfileId, normalizeBuyerEmail } from './guest-checkout-account-link.js';

@ApiTags('Checkout')
@Controller('orders')
export class CheckoutController {
  @Post('quote')
  @ApiOperation({ summary: 'Calculate a server-authoritative checkout quote' })
  @ApiBody({ schema: { type: 'object', required: ['eventId', 'items'], properties: { eventId: { type: 'string' }, items: { type: 'array', items: { type: 'object', required: ['ticketTypeId', 'quantity'], properties: { ticketTypeId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } } } } } } })
  async quote(@Body() body: unknown) {
    const input = readQuoteInput(body);
    const now = new Date();
    return withDatabase({
      unavailableMessage: 'checkout is not configured',
      callback: (database) => quoteCheckout({ database, ...input, now, holdTtlMs: 10 * 60 * 1000 }),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create an order and initialize payment when required' })
  @ApiBody({ schema: { type: 'object', required: ['eventId', 'buyer', 'items'], properties: { eventId: { type: 'string' }, buyer: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, phone: { type: 'string' } } }, items: { type: 'array', items: { type: 'object', required: ['ticketTypeId', 'quantity'], properties: { ticketTypeId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } } } } } } })
  async create(@Body() body: unknown) {
    const input = readCreateOrderInput(body);
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    return withDatabase({
      unavailableMessage: 'checkout is not configured',
      callback: async (database) => {
        const quote = await quoteCheckout({ database, eventId: input.eventId, items: input.items, now, holdTtlMs: 10 * 60 * 1000 });
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (quote.totalKobo > 0 && !secretKey) throw new ServiceUnavailableException('payments are not configured');
        const profile = await database.applicationProfile.findFirst({
          where: { status: 'ACTIVE', user: { email: input.buyer.email } },
          select: { id: true },
        });
        const order = await createCheckoutOrder({
          database,
          ...input,
          customerProfileId: guestCheckoutProfileId(profile),
          reference: `ET-${randomUUID()}`,
          now,
          holdExpiresAt,
        });
        if (order.status === 'PAID') return order;
        try {
          const payment = await initializePayment({
            database,
            gateway: createPaystackGateway({ secretKey: secretKey as string }),
            orderReference: order.reference,
            paymentReference: `ETP-${randomUUID()}`,
            now,
          });
          return { ...order, payment };
        } catch {
          throw new ServiceUnavailableException({
            message: 'payment initialization failed; retry with the returned order reference',
            orderReference: order.reference,
          });
        }
      },
    });
  }

  @Get(':orderReference/status')
  @ApiOperation({ summary: 'Get limited status for a guest or customer order reference' })
  async status(@Param('orderReference') orderReference: string) {
    const status = await withDatabase({
      unavailableMessage: 'checkout is not configured',
      callback: (database) => getCustomerOrderStatus({ database, orderReference }),
    });
    if (!status) throw new NotFoundException('order was not found');
    return status;
  }
}

function readQuoteInput(body: unknown): { eventId: string; items: Array<{ ticketTypeId: string; quantity: number }> } {
  if (!isRecord(body) || !Array.isArray(body.items) || typeof body.eventId !== 'string' || !body.eventId.trim()) {
    throw new BadRequestException('eventId and items are required');
  }
  if (!body.items.length || !body.items.every((item) => isRecord(item) && typeof item.ticketTypeId === 'string' && !!item.ticketTypeId.trim() && Number.isSafeInteger(item.quantity) && (item.quantity as number) > 0)) {
    throw new BadRequestException('checkout details are invalid');
  }
  return { eventId: body.eventId, items: body.items as Array<{ ticketTypeId: string; quantity: number }> };
}

function readCreateOrderInput(body: unknown): {
  eventId: string;
  buyer: { name: string; email: string; phone?: string };
  items: Array<{ ticketTypeId: string; quantity: number }>;
} {
  if (!isRecord(body) || !isRecord(body.buyer) || !Array.isArray(body.items)) {
    throw new BadRequestException('eventId, buyer, and items are required');
  }
  const { eventId } = body;
  const { name, email, phone } = body.buyer;
  const normalizedEmail = typeof email === 'string' ? normalizeBuyerEmail(email) : null;
  if (
    typeof eventId !== 'string' || !eventId.trim() ||
    typeof name !== 'string' || !name.trim() ||
    !normalizedEmail ||
    (phone !== undefined && typeof phone !== 'string') ||
    !body.items.length ||
    !body.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.ticketTypeId === 'string' &&
        !!item.ticketTypeId.trim() &&
        Number.isSafeInteger(item.quantity) &&
        (item.quantity as number) > 0,
    )
  ) {
    throw new BadRequestException('checkout details are invalid');
  }
  return {
    eventId: eventId.trim(),
    buyer: phone === undefined ? { name: name.trim(), email: normalizedEmail } : { name: name.trim(), email: normalizedEmail, phone: phone.trim() },
    items: body.items as Array<{ ticketTypeId: string; quantity: number }>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
