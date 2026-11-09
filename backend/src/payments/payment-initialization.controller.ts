import { Controller, Headers, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { findActiveProfile } from '../identity/current-profile.js';
import { withDatabase } from '../persistence/database-operation.js';
import { initializePayment } from './payment-lifecycle.js';
import { createPaystackGateway } from './paystack-gateway.js';
import { authorizeOrderPayment } from './order-payment-authorization.js';

@ApiTags('Payments')
@Controller('orders')
export class PaymentInitializationController {
  @Post(':orderReference/payments')
  @ApiOperation({ summary: 'Initialize a Paystack payment attempt for a guest or customer order reference' })
  async initialize(
    @Req() request: Request,
    @Param('orderReference') orderReference: string,
    @Headers('x-guest-access-token') guestAccessToken = '',
  ) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new ServiceUnavailableException('payments are not configured');
    }
    const profile = await findActiveProfile(request, 'CUSTOMER');
    return withDatabase({
      unavailableMessage: 'payments are not configured',
      callback: async (database) => {
        const authorized = await authorizeOrderPayment({
          database,
          orderReference,
          customerProfileId: profile?.id ?? null,
          guestAccessToken,
        });
        if (!authorized) throw new NotFoundException('pending order was not found');
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
