import { Module } from '@nestjs/common';
import { OrganizerController } from './organizer.controller.js';

@Module({ controllers: [OrganizerController] })
export class OrganizerModule {}
