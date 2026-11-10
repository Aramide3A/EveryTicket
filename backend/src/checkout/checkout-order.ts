import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { assertEventCheckoutEligibility } from './checkout-eligibility.js';
import { calculateCheckoutQuote } from './quote.js';

export type CreateCheckoutOrderInput = {
  database: PrismaClient;
  customerProfileId?: string;
  eventId: string;
  reference: string;
  buyer: { name: string; email: string; phone?: string };
  items: Array<{ ticketTypeId: string; quantity: number }>;
  now: Date;
  holdExpiresAt: Date;
};

export async function createCheckoutOrder({
  database,
  customerProfileId,
  eventId,
  reference,
  buyer,
  items,
  now,
  holdExpiresAt,
}: CreateCheckoutOrderInput): Promise<{
  reference: string;
  status: 'PENDING_PAYMENT' | 'PAID';
  ticketSubtotalKobo: number;
  platformFeeKobo: number;
  totalKobo: number;
  paystackFeeKobo: number;
  paystackChargeKobo: number;
  guestAccessToken?: string;
}> {
  if (!reference || !buyer.name || !buyer.email || items.length === 0) {
    throw new RangeError('reference, buyer details, and ticket items are required');
  }
  if (holdExpiresAt <= now) {
    throw new RangeError('hold expiry must be in the future');
  }
  if (new Set(items.map(({ ticketTypeId }) => ticketTypeId)).size !== items.length) {
    throw new RangeError('each ticket type may appear only once');
  }

  return database.$transaction(async (transaction) => {
    const event = await transaction.event.findFirst({
      where: {
        id: eventId,
        status: 'PUBLISHED',
        organizer: { status: 'ACTIVE' },
      },
      select: { id: true, startAt: true },
    });
    if (!event) {
      throw new Error('event is unavailable for checkout');
    }
    assertEventCheckoutEligibility({ startAt: event.startAt, now });

    const feeRule = await transaction.platformFeeRule.findFirst({
      where: {
        activeFrom: { lte: now },
        OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
      },
      select: {
        id: true,
        version: true,
        mode: true,
        percentageBasisPoints: true,
        fixedAmountKobo: true,
        appliesToFreeOrder: true,
      },
    });
    if (!feeRule) {
      throw new Error('no active platform fee rule');
    }

    const ticketTypes = await transaction.ticketType.findMany({
      where: { id: { in: items.map(({ ticketTypeId }) => ticketTypeId) }, eventId, isActive: true },
      select: { id: true, name: true, priceKobo: true, capacity: true, maxPerOrder: true, salesStartAt: true, salesEndAt: true },
    });
    if (ticketTypes.length !== items.length) {
      throw new Error('one or more ticket types are unavailable');
    }
    const ticketTypeById = new Map(ticketTypes.map((ticketType) => [ticketType.id, ticketType]));
    for (const item of items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new RangeError('quantity must be a positive safe integer');
      }
      const ticketType = ticketTypeById.get(item.ticketTypeId);
      if (!ticketType || (ticketType.maxPerOrder !== null && item.quantity > ticketType.maxPerOrder)) {
        throw new Error('ticket quantity is unavailable');
      }
      if ((ticketType.salesStartAt && ticketType.salesStartAt > now) || (ticketType.salesEndAt && ticketType.salesEndAt <= now)) {
        throw new Error('ticket sales are unavailable');
      }
    }

    const fee = feeRule.mode === 'FIXED'
      ? { type: 'FIXED' as const, amountKobo: feeRule.fixedAmountKobo as number }
      : { type: 'PERCENTAGE' as const, basisPoints: feeRule.percentageBasisPoints as number };
    const quote = calculateCheckoutQuote({
      items: items.map((item) => ({ quantity: item.quantity, unitPriceKobo: ticketTypeById.get(item.ticketTypeId)?.priceKobo as number })),
      platformFeeRule: fee,
      chargePlatformFeeOnFreeOrder: feeRule.appliesToFreeOrder,
    });

    for (const item of [...items].sort((left, right) => left.ticketTypeId.localeCompare(right.ticketTypeId))) {
      const availability = await transaction.$queryRaw<{ capacity: number; held: number; issued: number }[]>`
        SELECT ticket_type.capacity,
          COALESCE((SELECT SUM(quantity) FROM inventory_hold WHERE "ticketTypeId" = ticket_type.id AND "expiresAt" > ${now}), 0)::INTEGER AS held,
          COALESCE((SELECT COUNT(*) FROM ticket WHERE "ticketTypeId" = ticket_type.id AND status = 'ACTIVE'), 0)::INTEGER AS issued
        FROM ticket_type
        WHERE ticket_type.id = ${item.ticketTypeId}
        FOR UPDATE
      `;
      const ticketType = availability[0];
      if (!ticketType || ticketType.held + ticketType.issued + item.quantity > ticketType.capacity) {
        throw new Error('inventory is unavailable');
      }
    }

    const guestAccessToken = customerProfileId ? undefined : randomBytes(32).toString('base64url');
    const order = await transaction.order.create({
      data: {
        reference, eventId, customerProfileId, buyerName: buyer.name, buyerEmail: buyer.email, buyerPhone: buyer.phone,
        guestAccessTokenDigest: guestAccessToken ? createHash('sha256').update(guestAccessToken).digest('hex') : null,
        ticketSubtotalKobo: quote.ticketSubtotalKobo, platformFeeKobo: quote.platformFeeKobo, totalKobo: quote.totalKobo,
        paystackFeeKobo: quote.paystackFeeKobo, paystackChargeKobo: quote.paystackChargeKobo,
        platformFeeRuleId: feeRule.id, platformFeeRuleVersion: feeRule.version, platformFeeMode: feeRule.mode,
        platformFeePercentageBasisPoints: feeRule.percentageBasisPoints, platformFeeFixedAmountKobo: feeRule.fixedAmountKobo,
        holdExpiresAt,
        lines: { create: items.map((item) => {
          const ticketType = ticketTypeById.get(item.ticketTypeId) as (typeof ticketTypes)[number];
          return { ticketTypeId: ticketType.id, ticketTypeName: ticketType.name, unitPriceKobo: ticketType.priceKobo, quantity: item.quantity };
        }) },
      },
      select: { id: true },
    });

    if (quote.totalKobo > 0) {
      await transaction.inventoryHold.createMany({
        data: items.map((item) => ({
          orderId: order.id,
          ticketTypeId: item.ticketTypeId,
          quantity: item.quantity,
          expiresAt: holdExpiresAt,
        })),
      });
      return { reference, status: 'PENDING_PAYMENT' as const, ...quote, ...(guestAccessToken ? { guestAccessToken } : {}) };
    }

    const tickets = items.flatMap((item) => {
        const ticketType = ticketTypeById.get(item.ticketTypeId) as (typeof ticketTypes)[number];
        return Array.from({ length: item.quantity }, () => ({
          id: randomUUID(),
          orderId: order.id, eventId, ticketTypeId: ticketType.id, holderName: buyer.name, holderEmail: buyer.email,
          ticketTypeName: ticketType.name, priceKobo: ticketType.priceKobo,
          admissionTokenDigest: createHash('sha256').update(randomUUID()).digest('hex'),
        }));
      });
    await transaction.ticket.createMany({ data: tickets });
    await transaction.ticketDocumentJob.createMany({
      data: tickets.map((ticket) => ({ ticketId: ticket.id, objectKey: `tickets/${ticket.id}.pdf` })),
    });
    await transaction.notificationJob.create({
      data: {
        orderId: order.id,
        type: 'ORDER_CONFIRMATION',
        recipientEmail: buyer.email,
        idempotencyKey: `order:${order.id}:confirmation`,
      },
    });
    await transaction.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: now } });
    return { reference, status: 'PAID' as const, ...quote, ...(guestAccessToken ? { guestAccessToken } : {}) };
  });
}
