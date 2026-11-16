import { AdminCarouselController, CarouselController } from '../media/carousel.controller.js';
import { Module } from '@nestjs/common';
import { AdministrationController } from './administration.controller.js';

@Module({ controllers: [AdministrationController, AdminCarouselController, CarouselController] })
export class AdministrationModule {}
