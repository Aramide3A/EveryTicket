import { Module } from '@nestjs/common';
import { AdministrationController } from './administration.controller.js';

@Module({ controllers: [AdministrationController] })
export class AdministrationModule {}
