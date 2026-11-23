import { AdminCarouselController, CarouselController } from '../media/carousel.controller.js';
import { Module } from '@nestjs/common';
import { AdminSignInController } from './admin-sign-in.controller.js';
import { AdministrationController } from './administration.controller.js';

@Module({ controllers: [AdminSignInController, AdministrationController, AdminCarouselController, CarouselController] })
export class AdministrationModule {}
