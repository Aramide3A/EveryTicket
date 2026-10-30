import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdmissionModule } from './admission/admission.module.js';
import { AdministrationModule } from './admin/administration.module.js';
import { RequestIdMiddleware } from './common/http/request-id.middleware.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { EventModule } from './events/event.module.js';
import { HealthModule } from './health/health.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { OrganizerModule } from './organizer/organizer.module.js';

@Module({
  imports: [HealthModule, CheckoutModule, PaymentsModule, CustomerModule, EventModule, AdmissionModule, OrganizerModule, AdministrationModule]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
