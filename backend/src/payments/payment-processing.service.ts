import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { withDatabase } from '../persistence/database-operation.js';
import { processVerifiedPayment } from './payment-lifecycle.js';
import { createPaystackGateway } from './paystack-gateway.js';

@Injectable()
export class PaymentProcessingService {
  async process(paymentReference: string) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new ServiceUnavailableException('payments are not configured');
    }
    return withDatabase({
      unavailableMessage: 'payments are not configured',
      callback: (database) => processVerifiedPayment({
        database,
        gateway: createPaystackGateway({ secretKey }),
        paymentReference,
        now: new Date(),
      }),
    });
  }
}
