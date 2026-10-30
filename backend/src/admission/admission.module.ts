import { Module } from '@nestjs/common';
import { AdmissionController } from './admission.controller.js';

@Module({ controllers: [AdmissionController] })
export class AdmissionModule {}
