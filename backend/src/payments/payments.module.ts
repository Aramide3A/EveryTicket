import { Module } from '@nestjs/common';
import { PaymentInitializationController } from './payment-initialization.controller.js';
import { PaymentProcessingService } from './payment-processing.service.js';
import { OrderPaymentReconciliationController, PaymentReconciliationController } from './payment-reconciliation.controller.js';
import { PaymentsController } from './payments.controller.js';

@Module({
  controllers: [PaymentsController, PaymentInitializationController, PaymentReconciliationController, OrderPaymentReconciliationController],
  providers: [PaymentProcessingService],
})
export class PaymentsModule {}
