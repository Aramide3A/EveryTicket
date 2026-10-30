import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { addGuest, confirmAdmission, createGuestList, createRsvpLink, exportGuestsCsv, getCheckInSummary, getRsvpLink, listGuests, previewAdmission, removeGuest, revokeGuest, submitRsvpResponse, updateGuest } from './rsvp-admission.js';

const runAdmissionDatabaseOperation = createDatabaseOperation('admission is not configured');

@ApiTags('RSVP and admission')
@Controller()
export class AdmissionController {
  private readonly withDatabase = runAdmissionDatabaseOperation;
  @Post('organizer/events/:eventId/guest-lists')
  @ApiBearerAuth('session')
  async createGuestList(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => createGuestList({
      database,
      organizerProfileId: profile.id,
      eventId,
      name: readString(body, 'name'),
      categories: readGuestCategories(body),
      maxResponses: readOptionalPositiveInteger(body, 'maxResponses'),
      expiresAt: readOptionalDate(body, 'expiresAt'),
    }));
  }

  @Post('organizer/guest-lists/:guestListId/links')
  @ApiBearerAuth('session')
  async createRsvpLink(@Req() request: Request, @Param('guestListId') guestListId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => createRsvpLink({
      database,
      organizerProfileId: profile.id,
      guestListId,
      categoryId: readOptionalString(body, 'categoryId'),
      maxResponses: readOptionalPositiveInteger(body, 'maxResponses'),
      expiresAt: readOptionalDate(body, 'expiresAt'),
    }));
  }

  @Post('rsvp/:token/responses')
  async respond(@Param('token') token: string, @Body() body: unknown) {
    return this.withDatabase((database) => submitRsvpResponse({
      database, token, idempotencyKey: readString(body, 'idempotencyKey'), name: readString(body, 'name'), email: readString(body, 'email'), requestedCategoryId: readOptionalString(body, 'requestedCategoryId'), now: new Date(),
    }));
  }

  @Get('rsvp/:token')
  async link(@Param('token') token: string) {
    return this.withDatabase((database) => getRsvpLink({ database, token, now: new Date() }));
  }

  @Get('organizer/guest-lists/:guestListId/guests')
  @ApiBearerAuth('session')
  async guests(
    @Req() request: Request,
    @Param('guestListId') guestListId: string,
    @Query('query') query: unknown,
    @Query('responseStatus') responseStatus: unknown,
    @Query('credentialStatus') credentialStatus: unknown,
  ) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => listGuests({
      database,
      organizerProfileId: profile.id,
      guestListId,
      query: readOptionalQueryString(query),
      responseStatus: readOptionalEnum(responseStatus, ['PENDING', 'ACCEPTED', 'DECLINED'] as const),
      credentialStatus: readOptionalEnum(credentialStatus, ['ACTIVE', 'REVOKED'] as const),
    }));
  }

  @Post('organizer/guest-lists/:guestListId/guests')
  @ApiBearerAuth('session')
  async addGuest(@Req() request: Request, @Param('guestListId') guestListId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => addGuest({
      database,
      organizerProfileId: profile.id,
      guestListId,
      name: readString(body, 'name'),
      email: readString(body, 'email'),
      categoryId: readOptionalString(body, 'categoryId'),
      now: new Date(),
    }));
  }

  @Patch('organizer/guests/:guestId')
  @ApiBearerAuth('session')
  async updateGuest(@Req() request: Request, @Param('guestId') guestId: string, @Body() body: unknown) {
    return this.updateGuestForOrganizer(request, guestId, body);
  }

  @Patch('organizer/guest-lists/:guestListId/guests')
  @ApiBearerAuth('session')
  async updateGuestInList(@Req() request: Request, @Param('guestListId') guestListId: string, @Body() body: unknown) {
    return this.updateGuestForOrganizer(request, readString(body, 'guestId'), body, guestListId);
  }

  private async updateGuestForOrganizer(request: Request, guestId: string, body: unknown, guestListId?: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => updateGuest({
      database,
      organizerProfileId: profile.id,
      guestListId,
      guestId,
      name: readString(body, 'name'),
      email: readString(body, 'email'),
    }));
    return { updated: true };
  }

  @Delete('organizer/guests/:guestId')
  @ApiBearerAuth('session')
  async removeGuest(@Req() request: Request, @Param('guestId') guestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => removeGuest({ database, organizerProfileId: profile.id, guestId }));
    return { removed: true };
  }

  @Get('organizer/guest-lists/:guestListId/guests.csv')
  @ApiBearerAuth('session')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async guestsCsv(@Req() request: Request, @Param('guestListId') guestListId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => exportGuestsCsv({ database, organizerProfileId: profile.id, guestListId }));
  }

  @Post('organizer/guests/:guestId/revoke')
  @ApiBearerAuth('session')
  async revoke(@Req() request: Request, @Param('guestId') guestId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await this.withDatabase((database) => revokeGuest({ database, organizerProfileId: profile.id, guestId, now: new Date() }));
    return { revoked: true };
  }

  @Post('organizer/events/:eventId/check-ins/preview')
  @ApiBearerAuth('session')
  async preview(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => previewAdmission({ database, organizerProfileId: profile.id, eventId, token: readString(body, 'token'), ticketCredentialSecret: process.env.ADMISSION_TOKEN_SECRET }));
  }

  @Post('organizer/events/:eventId/check-ins/confirm')
  @ApiBearerAuth('session')
  async confirm(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => confirmAdmission({ database, organizerProfileId: profile.id, eventId, token: readString(body, 'token'), now: new Date(), ticketCredentialSecret: process.env.ADMISSION_TOKEN_SECRET }));
  }

  @Get('organizer/events/:eventId/check-ins/summary')
  @ApiBearerAuth('session')
  async summary(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return this.withDatabase((database) => getCheckInSummary({ database, organizerProfileId: profile.id, eventId }));
  }

}

function readString(body: unknown, field: string): string {
  if (!isRecord(body) || typeof body[field] !== 'string' || !body[field].trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return body[field];
}

function readOptionalString(body: unknown, field: string): string | undefined {
  if (!isRecord(body) || body[field] === undefined) return undefined;
  if (typeof body[field] !== 'string' || !body[field].trim()) throw new BadRequestException(`${field} is invalid`);
  return body[field];
}

function readOptionalQueryString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('query is invalid');
  return value.trim();
}

function readGuestCategories(body: unknown): Array<{ name: string; isRestricted: boolean }> {
  if (!isRecord(body) || body.categories === undefined) return [];
  if (!Array.isArray(body.categories)) throw new BadRequestException('categories is invalid');
  return body.categories.map((category) => {
    if (!isRecord(category) || typeof category.name !== 'string' || !category.name.trim() || typeof category.isRestricted !== 'boolean') {
      throw new BadRequestException('guest category is invalid');
    }
    return { name: category.name, isRestricted: category.isRestricted };
  });
}

function readOptionalPositiveInteger(body: unknown, field: string): number | undefined {
  if (!isRecord(body) || body[field] === undefined) return undefined;
  if (typeof body[field] !== 'number' || !Number.isInteger(body[field]) || body[field] < 1) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return body[field];
}

function readOptionalDate(body: unknown, field: string): Date | undefined {
  if (!isRecord(body) || body[field] === undefined) return undefined;
  if (typeof body[field] !== 'string') throw new BadRequestException(`${field} is invalid`);
  const value = new Date(body[field]);
  if (Number.isNaN(value.getTime())) throw new BadRequestException(`${field} is invalid`);
  return value;
}

function readOptionalEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value)) throw new BadRequestException('query filter is invalid');
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
