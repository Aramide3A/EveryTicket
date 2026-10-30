import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { CustomerController } from './customer.controller.js';

@Module({ controllers: [CustomerController, AccountController] })
export class CustomerModule {}
