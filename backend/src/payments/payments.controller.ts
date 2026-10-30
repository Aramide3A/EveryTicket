import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentProcessingService } from './payment-processing.service.js';
import { handlePaystackWebhook } from './paystack-webhook.js';

@ApiTags('Payments')
@Controller('webhooks')
export class PaymentsController {
  constructor(private readonly paymentProcessing: PaymentProcessingService) {}

  @Post('paystack')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive and authenticate a Paystack webhook' })
  async receivePaystackWebhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature: string | undefined,
  ): Promise<{ accepted: boolean }> {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      throw new ServiceUnavailableException('payments are not configured');
    }
    if (!request.rawBody) {
      throw new BadRequestException('raw webhook body is unavailable');
    }

    try {
      return await handlePaystackWebhook({
        rawBody: request.rawBody,
        signature,
        secret,
        onChargeSuccess: (paymentReference) => this.paymentProcessing.process(paymentReference).then(() => undefined),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'webhook signature is invalid') {
        throw new UnauthorizedException('webhook signature is invalid');
      }
      throw error;
    }
  }

}
