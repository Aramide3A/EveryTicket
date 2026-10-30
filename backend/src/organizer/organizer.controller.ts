import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { completeEventMediaUpload, createEventMediaUploadIntent } from '../media/event-media-operations.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { createR2ObjectStore } from '../worker/r2-object-store.js';
import { readR2Config } from '../worker/worker-config.js';
import { cancelRefundRequest, createPayoutRequest, createRefundRequest, exportOrganizerAttendeesCsv, getOrganizerDashboard, listOrganizerAttendees, listOrganizerOrders, listOrganizerPayoutRequests, listOrganizerRefundRequests, updateRefundRequest } from './organizer-operations.js';

const runOrganizerDatabaseOperation = createDatabaseOperation('organizer operations are not configured');

@ApiTags('Organizer operations')
@ApiBearerAuth('session')
@Controller('organizer')
export class OrganizerController {
  private readonly withDatabase = runOrganizerDatabaseOperation;
  @Get('events/:eventId/dashboard')
  async dashboard(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => getOrganizerDashboard({ database, organizerProfileId: profile.id, eventId, now: new Date() }));
  }

  @Get('events/:eventId/orders')
  async orders(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listOrganizerOrders({ database, organizerProfileId: profile.id, eventId }));
  }

  @Get('events/:eventId/attendees')
  async attendees(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listOrganizerAttendees({ database, organizerProfileId: profile.id, eventId }));
  }

  @Get('events/:eventId/attendees.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async attendeesCsv(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => exportOrganizerAttendeesCsv({ database, organizerProfileId: profile.id, eventId }));
  }

  @Post('events/:eventId/media/upload-intent')
  async mediaUploadIntent(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    const objectStore = createR2ObjectStore({ config: readR2Config(process.env) });
    return this.withDatabase((database) => createEventMediaUploadIntent({
      database,
      organizerProfileId: profile.id,
      eventId,
      contentType: readString(body, 'contentType'),
      contentLength: readInteger(body, 'contentLength'),
      createUpload: (input) => objectStore.createPublicImageUploadUrl(input),
      now: new Date(),
    }));
  }

  @Post('events/:eventId/media/:mediaId/complete')
  async completeMediaUpload(@Req() request: Request, @Param('eventId') eventId: string, @Param('mediaId') mediaId: string) {
    return this.completeMediaUploadForOrganizer(request, eventId, mediaId);
  }

  @Post('events/:eventId/media/complete')
  async completeMediaUploadFromBody(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.completeMediaUploadForOrganizer(request, eventId, readString(body, 'mediaId'));
  }

  private async completeMediaUploadForOrganizer(request: Request, eventId: string, mediaId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    const objectStore = createR2ObjectStore({ config: readR2Config(process.env) });
    await this.withDatabase((database) => completeEventMediaUpload({
      database,
      organizerProfileId: profile.id,
      eventId,
      mediaId,
      verifyUploadedObject: (input) => objectStore.verifyPublicImage(input),
      now: new Date(),
    }));
    return { completed: true };
  }

  @Post('orders/:orderId/refund-requests')
  async requestRefund(@Req() request: Request, @Param('orderId') orderId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => createRefundRequest({
      database,
      organizerProfileId: profile.id,
      orderId,
      ticketIds: readStringArray(body, 'ticketIds'),
      ticketRefundKobo: readInteger(body, 'ticketRefundKobo'),
      platformFeeRefundKobo: readInteger(body, 'platformFeeRefundKobo'),
      reason: readString(body, 'reason'),
      now: new Date(),
    }));
  }

  @Patch('refund-requests/:refundRequestId')
  async updateRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => updateRefundRequest({
      database,
      organizerProfileId: profile.id,
      refundRequestId,
      ticketRefundKobo: readInteger(body, 'ticketRefundKobo'),
      platformFeeRefundKobo: readInteger(body, 'platformFeeRefundKobo'),
      reason: readString(body, 'reason'),
    }));
  }

  @Post('refund-requests/:refundRequestId/cancel')
  async cancelRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => cancelRefundRequest({ database, organizerProfileId: profile.id, refundRequestId }));
    return { cancelled: true };
  }

  @Get('refund-requests')
  async refundRequests(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listOrganizerRefundRequests({ database, organizerProfileId: profile.id }));
  }

  @Post('events/:eventId/payout-requests')
  async requestPayout(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => createPayoutRequest({ database, organizerProfileId: profile.id, eventId, now: new Date() }));
  }

  @Get('payout-requests')
  async payoutRequests(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listOrganizerPayoutRequests({ database, organizerProfileId: profile.id }));
  }

}

function readString(body: unknown, field: string): string {
  if (!isRecord(body) || typeof body[field] !== 'string' || !body[field].trim()) throw new BadRequestException(`${field} is required`);
  return body[field];
}

function readInteger(body: unknown, field: string): number {
  if (!isRecord(body) || typeof body[field] !== 'number' || !Number.isInteger(body[field]) || body[field] < 0) throw new BadRequestException(`${field} is invalid`);
  return body[field];
}

function readStringArray(body: unknown, field: string): string[] {
  if (!isRecord(body) || !Array.isArray(body[field]) || !body[field].length || body[field].some((value) => typeof value !== 'string' || !value.trim())) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return body[field] as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
