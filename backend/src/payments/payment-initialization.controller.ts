import { Controller, NotFoundException, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { withDatabase } from '../persistence/database-operation.js';
import { initializePayment } from './payment-lifecycle.js';
import { createPaystackGateway } from './paystack-gateway.js';

@ApiTags('Payments')
@Controller('orders')
export class PaymentInitializationController {
  @Post(':orderReference/payments')
  @ApiOperation({ summary: 'Initialize a Paystack payment attempt for a guest or customer order reference' })
  async initialize(@Param('orderReference') orderReference: string) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new ServiceUnavailableException('payments are not configured');
    }
    return withDatabase({
      unavailableMessage: 'payments are not configured',
      callback: async (database) => {
        const order = await database.order.findUnique({
          where: { reference: orderReference },
          select: { id: true },
        });
        if (!order) throw new NotFoundException('pending order was not found');
        return initializePayment({
          database,
          gateway: createPaystackGateway({ secretKey }),
          orderReference,
          paymentReference: `ETP-${randomUUID()}`,
          now: new Date(),
        });
      },
    });
  }
}
