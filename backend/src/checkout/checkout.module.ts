import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller.js';

@Module({ controllers: [CheckoutController] })
export class CheckoutModule {}
