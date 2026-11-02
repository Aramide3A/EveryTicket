import { Module } from '@nestjs/common';
import { OrganizerController } from './organizer.controller.js';
import { OrganizerRegistrationController } from './organizer-registration.controller.js';

@Module({ controllers: [OrganizerController, OrganizerRegistrationController] })
export class OrganizerModule {}
