import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { completeEventMediaUpload, createEventMediaUploadIntent, listOwnedEventMedia, removeEventMedia, reorderEventMedia, setEventCover } from '../media/event-media-operations.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { readPagination } from '../common/http/pagination.js';
import { createR2ObjectStore } from '../worker/r2-object-store.js';
import { readR2Config } from '../worker/worker-config.js';
import { cancelRefundRequest, createPayoutRequest, createRefundRequest, exportOrganizerAttendeesCsv, exportOrganizerCheckInsCsv, exportOrganizerPayoutReceiptCsv, getOrganizerDashboard, getOrganizerOrderRefundInputs, getOrganizerPayoutRequest, getOrganizerRefundRequest, listOrganizerCheckIns, pageOrganizerAttendees, pageOrganizerOrders, pageOrganizerPayoutRequests, pageOrganizerRefundRequests, updateRefundRequest } from './organizer-operations.js';

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
  async orders(@Req() request: Request, @Param('eventId') eventId: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('q') query?: string, @Query('status') status?: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => pageOrganizerOrders({ database, organizerProfileId: profile.id, eventId, query, status: readOptionalEnum(status, ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID_NEEDS_RESOLUTION'] as const), ...readPagination(page, pageSize) }));
  }

  @Get('orders/:orderId/refund-inputs')
  async refundInputs(@Req() request: Request, @Param('orderId') orderId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => getOrganizerOrderRefundInputs({ database, organizerProfileId: profile.id, orderId }));
  }

  @Get('events/:eventId/attendees')
  async attendees(@Req() request: Request, @Param('eventId') eventId: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('q') query?: string, @Query('kind') kind?: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => pageOrganizerAttendees({ database, organizerProfileId: profile.id, eventId, query, kind: readOptionalEnum(kind, ['TICKET', 'GUEST'] as const), ...readPagination(page, pageSize) }));
  }

  @Get('events/:eventId/attendees.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async attendeesCsv(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => exportOrganizerAttendeesCsv({ database, organizerProfileId: profile.id, eventId }));
  }

  @Get('events/:eventId/check-ins')
  async checkIns(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listOrganizerCheckIns({ database, organizerProfileId: profile.id, eventId }));
  }

  @Get('events/:eventId/check-ins.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async checkInsCsv(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => exportOrganizerCheckInsCsv({ database, organizerProfileId: profile.id, eventId }));
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

  @Get('events/:eventId/media')
  async media(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listOwnedEventMedia({ database, organizerProfileId: profile.id, eventId }));
  }

  @Put('events/:eventId/media/order')
  async reorderMedia(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => reorderEventMedia({ database, organizerProfileId: profile.id, eventId, mediaIds: readStringArray(body, 'mediaIds') }));
    return { updated: true };
  }

  @Put('events/:eventId/media/cover')
  async coverMedia(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => setEventCover({ database, organizerProfileId: profile.id, eventId, mediaId: readString(body, 'mediaId') }));
    return { updated: true };
  }

  @Delete('events/:eventId/media/:mediaId')
  async removeMedia(@Req() request: Request, @Param('eventId') eventId: string, @Param('mediaId') mediaId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    const objectStore = createR2ObjectStore({ config: readR2Config(process.env) });
    await this.withDatabase((database) => removeEventMedia({ database, organizerProfileId: profile.id, eventId, mediaId, deleteObject: (objectKey) => objectStore.deletePublicObject({ objectKey }) }));
    return { removed: true };
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

  @Get('refund-requests/:refundRequestId')
  async refundRequest(@Req() request: Request, @Param('refundRequestId') refundRequestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => getOrganizerRefundRequest({ database, organizerProfileId: profile.id, refundRequestId }));
  }

  @Post('refund-requests/:refundRequestId/cancel')
  async cancelRefund(@Req() request: Request, @Param('refundRequestId') refundRequestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => cancelRefundRequest({ database, organizerProfileId: profile.id, refundRequestId }));
    return { cancelled: true };
  }

  @Get('refund-requests')
  async refundRequests(@Req() request: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => pageOrganizerRefundRequests({ database, organizerProfileId: profile.id, status: readOptionalEnum(status, ['REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'CANCELLED'] as const), ...readPagination(page, pageSize) }));
  }

  @Post('events/:eventId/payout-requests')
  async requestPayout(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => createPayoutRequest({ database, organizerProfileId: profile.id, eventId, now: new Date() }));
  }

  @Get('payout-requests')
  async payoutRequests(@Req() request: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => pageOrganizerPayoutRequests({ database, organizerProfileId: profile.id, status: readOptionalEnum(status, ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'] as const), ...readPagination(page, pageSize) }));
  }

  @Get('payout-requests/:payoutRequestId')
  async payoutRequest(@Req() request: Request, @Param('payoutRequestId') payoutRequestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => getOrganizerPayoutRequest({ database, organizerProfileId: profile.id, payoutRequestId }));
  }

  @Get('payout-requests/:payoutRequestId/receipt.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async payoutReceipt(@Req() request: Request, @Param('payoutRequestId') payoutRequestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => exportOrganizerPayoutReceiptCsv({ database, organizerProfileId: profile.id, payoutRequestId }));
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

function readOptionalEnum<const T extends readonly string[]>(value: string | undefined, values: T): T[number] | undefined {
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new BadRequestException('filter is invalid');
  return value as T[number];
}
