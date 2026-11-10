import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireActiveProfile } from '../identity/current-profile.js';
import { createDatabaseOperation } from '../persistence/database-operation.js';
import { createOwnedEvent, createOwnedTicketType, getPublicEvent, listPublicEvents, publishOwnedEvent, removeOwnedTicketType, unpublishOwnedEvent, updateOwnedEvent, updateOwnedTicketType } from './event-catalogue.js';
import { cancelOwnedEvent, removeOwnedEvent } from './event-lifecycle.js';

const runEventDatabaseOperation = createDatabaseOperation('event catalogue is not configured');

@ApiTags('Events')
@Controller()
export class EventController {
  @Post('organizer/events')
  @ApiBearerAuth('session')
  async create(@Req() request: Request, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    const input = readEventInput(body);
    return runEventDatabaseOperation((database) => createOwnedEvent({ database, organizerProfileId: profile.id, ...input }));
  }

  @Get('organizer/events')
  @ApiBearerAuth('session')
  async ownedEvents(@Req() request: Request) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return runEventDatabaseOperation((database) => database.event.findMany({
      where: { organizerProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, slug: true, status: true, startAt: true, endAt: true,
        media: { where: { status: 'READY' }, orderBy: [{ isCover: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }], select: { id: true, publicUrl: true, isCover: true } },
      },
    }));
  }

  @Get('organizer/events/:eventId')
  @ApiBearerAuth('session')
  async ownedEvent(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return runEventDatabaseOperation((database) => database.event.findFirst({
      where: { id: eventId, organizerProfileId: profile.id },
      select: {
        id: true, categoryId: true, title: true, slug: true, description: true, city: true, state: true, venue: true, address: true, timeZone: true, startAt: true, endAt: true, status: true,
        media: { where: { status: 'READY' }, orderBy: [{ isCover: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }], select: { id: true, publicUrl: true, isCover: true } },
        ticketTypes: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, description: true, priceKobo: true, capacity: true, salesStartAt: true, salesEndAt: true, isActive: true, maxPerOrder: true } },
      },
    }));
  }

  @Patch('organizer/events/:eventId')
  @ApiBearerAuth('session')
  async update(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await runEventDatabaseOperation((database) => updateOwnedEvent({ database, organizerProfileId: profile.id, eventId, ...readEventPatch(body) }));
    return { updated: true };
  }

  @Get('categories')
  @ApiOperation({ summary: 'List public event categories' })
  async categories() {
    return runEventDatabaseOperation((database) => database.eventCategory.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }));
  }

  @Get('ticket-categories')
  @ApiOperation({ summary: 'List reusable ticket-type templates' })
  async ticketCategories() {
    return runEventDatabaseOperation((database) => database.ticketCategoryTemplate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, description: true } }));
  }

  @Get('events')
  @ApiOperation({ summary: 'List public published events' })
  async events(@Query('query') query?: string, @Query('city') city?: string, @Query('state') state?: string, @Query('category') category?: string, @Query('sort') sort?: string, @Query('page') page?: string) {
    if (sort !== undefined && !['upcoming', 'featured', 'popular'].includes(sort)) throw new BadRequestException('sort is invalid');
    return runEventDatabaseOperation((database) => listPublicEvents({ database, query, city, state, category, sort: sort as 'upcoming' | 'featured' | 'popular' | undefined, page: page === undefined ? undefined : Number(page) }));
  }

  @Get('events/:slug')
  @ApiOperation({ summary: 'Get a public event by slug' })
  async event(@Param('slug') slug: string) {
    return runEventDatabaseOperation((database) => getPublicEvent({ database, slug }));
  }

  @Post('organizer/events/:eventId/publish')
  @ApiBearerAuth('session')
  async publish(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await runEventDatabaseOperation((database) => publishOwnedEvent({ database, organizerProfileId: profile.id, eventId, now: new Date() }));
    return { published: true };
  }

  @Post('organizer/events/:eventId/unpublish')
  @ApiBearerAuth('session')
  async unpublish(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await runEventDatabaseOperation((database) => unpublishOwnedEvent({ database, organizerProfileId: profile.id, eventId }));
    return { unpublished: true };
  }

  @Post('organizer/events/:eventId/cancel')
  @ApiBearerAuth('session')
  async cancel(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    const reason = readStringValue(readObject(body, 'cancellation reason is required'), 'reason');
    await runEventDatabaseOperation((database) => cancelOwnedEvent({ database, organizerProfileId: profile.id, eventId, reason, now: new Date() }));
    return { cancelled: true };
  }

  @Delete('organizer/events/:eventId')
  @ApiBearerAuth('session')
  async remove(@Req() request: Request, @Param('eventId') eventId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await runEventDatabaseOperation((database) => removeOwnedEvent({ database, organizerProfileId: profile.id, eventId }));
    return { removed: true };
  }

  @Post('organizer/events/:eventId/ticket-types')
  @ApiBearerAuth('session')
  async createTicketType(@Req() request: Request, @Param('eventId') eventId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    return runEventDatabaseOperation((database) => createOwnedTicketType({ database, organizerProfileId: profile.id, eventId, ...readTicketTypeInput(body) }));
  }

  @Patch('organizer/events/:eventId/ticket-types/:ticketTypeId')
  @ApiBearerAuth('session')
  async updateTicketType(@Req() request: Request, @Param('eventId') eventId: string, @Param('ticketTypeId') ticketTypeId: string, @Body() body: unknown) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await runEventDatabaseOperation((database) => updateOwnedTicketType({ database, organizerProfileId: profile.id, eventId, ticketTypeId, ...readTicketTypePatch(body) }));
    return { updated: true };
  }

  @Delete('organizer/events/:eventId/ticket-types/:ticketTypeId')
  @ApiBearerAuth('session')
  async removeTicketType(@Req() request: Request, @Param('eventId') eventId: string, @Param('ticketTypeId') ticketTypeId: string) {
    const profile = await requireActiveProfile(request, 'ORGANIZER');
    await runEventDatabaseOperation((database) => removeOwnedTicketType({ database, organizerProfileId: profile.id, eventId, ticketTypeId }));
    return { removed: true };
  }

}

function readEventInput(body: unknown): Omit<Parameters<typeof createOwnedEvent>[0], 'database' | 'organizerProfileId'> {
  if (!body || typeof body !== 'object') throw new BadRequestException('event details are required');
  const value = body as Record<string, unknown>;
  const string = (name: string): string => {
    const field = value[name];
    if (typeof field !== 'string' || !field.trim()) throw new BadRequestException(`${name} is required`);
    return field;
  };
  const date = (name: string): Date => {
    const result = new Date(string(name));
    if (Number.isNaN(result.getTime())) throw new BadRequestException(`${name} is invalid`);
    return result;
  };
  return { categoryId: string('categoryId'), title: string('title'), slug: string('slug'), description: string('description'), city: string('city'), state: string('state'), venue: string('venue'), address: string('address'), timeZone: string('timeZone'), startAt: date('startAt'), endAt: date('endAt') };
}

function readEventPatch(body: unknown): Omit<Parameters<typeof updateOwnedEvent>[0], 'database' | 'organizerProfileId' | 'eventId'> {
  const value = readObject(body, 'event details are required');
  const string = (name: string): string | undefined => value[name] === undefined ? undefined : readStringValue(value, name);
  const date = (name: string): Date | undefined => value[name] === undefined ? undefined : readDateValue(value, name);
  const result = { categoryId: string('categoryId'), title: string('title'), slug: string('slug'), description: string('description'), city: string('city'), state: string('state'), venue: string('venue'), address: string('address'), timeZone: string('timeZone'), startAt: date('startAt'), endAt: date('endAt') };
  if (!Object.values(result).some((field) => field !== undefined)) throw new BadRequestException('event changes are required');
  return result;
}

function readTicketTypeInput(body: unknown): Omit<Parameters<typeof createOwnedTicketType>[0], 'database' | 'organizerProfileId' | 'eventId'> {
  const value = readObject(body, 'ticket type details are required');
  return { name: readStringValue(value, 'name'), description: optionalStringValue(value, 'description'), priceKobo: readIntegerValue(value, 'priceKobo'), capacity: readIntegerValue(value, 'capacity'), salesStartAt: optionalDateValue(value, 'salesStartAt'), salesEndAt: optionalDateValue(value, 'salesEndAt'), maxPerOrder: optionalIntegerValue(value, 'maxPerOrder') };
}

function readTicketTypePatch(body: unknown): Omit<Parameters<typeof updateOwnedTicketType>[0], 'database' | 'organizerProfileId' | 'eventId' | 'ticketTypeId'> {
  const value = readObject(body, 'ticket type changes are required');
  const result = {
    name: value.name === undefined ? undefined : readStringValue(value, 'name'),
    description: value.description === undefined ? undefined : value.description === null ? null : readStringValue(value, 'description'),
    priceKobo: value.priceKobo === undefined ? undefined : readIntegerValue(value, 'priceKobo'),
    capacity: value.capacity === undefined ? undefined : readIntegerValue(value, 'capacity'),
    salesStartAt: value.salesStartAt === undefined ? undefined : value.salesStartAt === null ? null : readDateValue(value, 'salesStartAt'),
    salesEndAt: value.salesEndAt === undefined ? undefined : value.salesEndAt === null ? null : readDateValue(value, 'salesEndAt'),
    maxPerOrder: value.maxPerOrder === undefined ? undefined : value.maxPerOrder === null ? null : readIntegerValue(value, 'maxPerOrder'),
    isActive: value.isActive === undefined ? undefined : readBooleanValue(value, 'isActive'),
  };
  if (!Object.values(result).some((field) => field !== undefined)) throw new BadRequestException('ticket type changes are required');
  return result;
}

function readObject(body: unknown, message: string): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new BadRequestException(message);
  return body as Record<string, unknown>;
}

function readStringValue(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== 'string' || !field.trim()) throw new BadRequestException(`${name} is required`);
  return field;
}

function optionalStringValue(value: Record<string, unknown>, name: string): string | undefined {
  return value[name] === undefined ? undefined : readStringValue(value, name);
}

function readDateValue(value: Record<string, unknown>, name: string): Date {
  const result = new Date(readStringValue(value, name));
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${name} is invalid`);
  return result;
}

function optionalDateValue(value: Record<string, unknown>, name: string): Date | undefined {
  return value[name] === undefined ? undefined : readDateValue(value, name);
}

function readIntegerValue(value: Record<string, unknown>, name: string): number {
  const field = value[name];
  if (!Number.isSafeInteger(field)) throw new BadRequestException(`${name} is invalid`);
  return field as number;
}

function optionalIntegerValue(value: Record<string, unknown>, name: string): number | undefined {
  return value[name] === undefined ? undefined : readIntegerValue(value, name);
}

function readBooleanValue(value: Record<string, unknown>, name: string): boolean {
  if (typeof value[name] !== 'boolean') throw new BadRequestException(`${name} is invalid`);
  return value[name];
}
