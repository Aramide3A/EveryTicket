import { Module } from '@nestjs/common';
import { EventController } from './event.controller.js';

@Module({ controllers: [EventController] })
export class EventModule {}
