import { Controller, Headers, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { findActiveProfile, requireActiveProfile } from '../identity/current-profile.js';
import { withDatabase } from '../persistence/database-operation.js';
import { PaymentProcessingService } from './payment-processing.service.js';
import { findLatestInitializedPaymentReference } from './order-payment-access.js';
import { authorizeOrderPayment } from './order-payment-authorization.js';

@ApiTags('Payments')
@ApiBearerAuth('session')
@Controller('payments')
export class PaymentReconciliationController {
  constructor(private readonly paymentProcessing: PaymentProcessingService) {}

  @Post(':paymentReference/reconcile')
  @ApiOperation({ summary: 'Reconcile an owned legacy payment reference' })
  async reconcile(@Req() request: Request, @Param('paymentReference') paymentReference: string) {
    if (!process.env.PAYSTACK_SECRET_KEY) throw new ServiceUnavailableException('payments are not configured');
    const profile = await requireActiveProfile(request, 'CUSTOMER');
    const ownedPayment = await withDatabase({
      unavailableMessage: 'payments are not configured',
      callback: (database) => database.paymentAttempt.findFirst({
        where: { reference: paymentReference, order: { customerProfileId: profile.id } },
        select: { id: true },
      }),
    });
    if (!ownedPayment) throw new NotFoundException('payment was not found');
    return this.paymentProcessing.process(paymentReference);
  }
}

@ApiTags('Payments')
@Controller('orders')
export class OrderPaymentReconciliationController {
  constructor(private readonly paymentProcessing: PaymentProcessingService) {}

  @Post(':orderReference/reconcile')
  @ApiOperation({ summary: 'Reconcile the latest payment attempt for a guest or customer order reference' })
  async reconcile(
    @Req() request: Request,
    @Param('orderReference') orderReference: string,
    @Headers('x-guest-access-token') guestAccessToken = '',
  ) {
    const profile = await findActiveProfile(request, 'CUSTOMER');
    const paymentReference = await withDatabase({
      unavailableMessage: 'payments are not configured',
      callback: async (database) => {
        const authorized = await authorizeOrderPayment({
          database,
          orderReference,
          customerProfileId: profile?.id ?? null,
          guestAccessToken,
        });
        if (!authorized) return null;
        return findLatestInitializedPaymentReference({ database, orderReference });
      },
    });
    if (!paymentReference) throw new NotFoundException('pending payment was not found');
    return this.paymentProcessing.process(paymentReference);
  }
}
