import { Controller, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { withDatabase } from '../persistence/database-operation.js';
import { initializePayment } from './payment-lifecycle.js';
import { createPaystackGateway } from './paystack-gateway.js';

@ApiTags('Payments')
@ApiBearerAuth('session')
@Controller('orders')
export class PaymentInitializationController {
  @Post(':orderReference/payments')
  @ApiOperation({ summary: 'Initialize a Paystack payment attempt for the owning customer' })
  async initialize(@Req() request: Request, @Param('orderReference') orderReference: string) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new ServiceUnavailableException('payments are not configured');
    }
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    return withDatabase({
      unavailableMessage: 'payments are not configured',
      callback: async (database) => {
        const ownedOrder = await database.order.findFirst({
          where: { reference: orderReference, customerProfileId: profile.id },
          select: { id: true },
        });
        if (!ownedOrder) throw new NotFoundException('pending order was not found');
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
