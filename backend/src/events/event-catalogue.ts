import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

export async function createOwnedEvent({
  database,
  organizerProfileId,
  categoryId,
  title,
  slug,
  description,
  city,
  state,
  venue,
  address,
  timeZone,
  startAt,
  endAt,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  city: string;
  state: string;
  venue: string;
  address: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
}): Promise<{ id: string }> {
  if (!title.trim() || !slug.trim() || !description.trim() || !city.trim() || !state.trim() || !venue.trim() || !address.trim() || !timeZone.trim() || startAt >= endAt) throw new RangeError('event details are invalid');
  const organizer = await database.applicationProfile.findFirst({ where: { id: organizerProfileId, status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') }, select: { id: true } });
  if (!organizer) throw new Error('event is unavailable to this organizer');
  const event = await database.event.create({ data: { organizerProfileId, categoryId, title: title.trim(), slug: slug.trim(), description: description.trim(), city: city.trim(), state: state.trim(), venue: venue.trim(), address: address.trim(), timeZone: timeZone.trim(), startAt, endAt }, select: { id: true } });
  await recordOrganizerAudit(database, organizerProfileId, 'EVENT_CREATED', 'EVENT', event.id, { categoryId, title: title.trim() });
  return event;
}

export async function publishOwnedEvent({
  database,
  organizerProfileId,
  eventId,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  now: Date;
}): Promise<void> {
  const event = await database.event.findFirst({
    where: {
      id: eventId,
      organizerProfileId,
      status: 'DRAFT',
      organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') },
      endAt: { gt: now },
      startAt: { gt: now },
    },
    select: { id: true },
  });
  if (!event) throw new Error('event is unavailable to this organizer');
  await database.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED', publishedAt: now } });
  await recordOrganizerAudit(database, organizerProfileId, 'EVENT_PUBLISHED', 'EVENT', event.id);
}

export async function listPublicEvents({
  database,
  query,
  city,
  state,
  category,
  sort = 'upcoming',
  page = 1,
  now = new Date(),
}: {
  database: PrismaClient;
  query?: string;
  city?: string;
  state?: string;
  category?: string;
  sort?: 'upcoming' | 'featured' | 'popular';
  page?: number;
  now?: Date;
}): Promise<{ items: Array<{ id: string; slug: string; title: string; description: string; city: string; state: string; venue: string; startAt: Date; endAt: Date; category: { name: string; slug: string }; organizer: { name: string }; media: Array<{ id: string; publicUrl: string; isCover: boolean }>; availableTickets: number }>; page: number; total: number }> {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('page is invalid');
  if (!['upcoming', 'featured', 'popular'].includes(sort)) throw new RangeError('event sort is invalid');
  const where = {
    status: 'PUBLISHED' as const,
    organizer: { status: 'ACTIVE' as const },
    startAt: { gt: now },
    ...(query ? { OR: [{ title: { contains: query, mode: 'insensitive' as const } }, { description: { contains: query, mode: 'insensitive' as const } }] } : {}),
    ...(city ? { city: { equals: city, mode: 'insensitive' as const } } : {}),
    ...(state ? { state: { equals: state, mode: 'insensitive' as const } } : {}),
    ...(category ? { category: { slug: category } } : {}),
  };
  const orderBy = sort === 'featured'
    ? [{ featured: 'desc' as const }, { startAt: 'asc' as const }]
    : sort === 'popular'
      ? [{ tickets: { _count: 'desc' as const } }, { startAt: 'asc' as const }]
      : [{ startAt: 'asc' as const }];
  const [items, total] = await Promise.all([
    database.event.findMany({
      where,
      orderBy,
      skip: (page - 1) * 20,
      take: 20,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        city: true,
        state: true,
        venue: true,
        startAt: true,
        endAt: true,
        category: { select: { name: true, slug: true } },
        organizer: { select: { user: { select: { name: true } } } },
        media: { where: { status: 'READY' }, orderBy: [{ isCover: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }], select: { id: true, publicUrl: true, isCover: true } },
        ticketTypes: {
          where: { isActive: true },
          select: {
            capacity: true,
            tickets: { where: { status: 'ACTIVE' }, select: { id: true } },
            holds: { where: { expiresAt: { gt: now } }, select: { quantity: true } },
          },
        },
      },
    }),
    database.event.count({ where }),
  ]);
  return {
    items: items.map((event) => ({
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      city: event.city,
      state: event.state,
      venue: event.venue,
      startAt: event.startAt,
      endAt: event.endAt,
      category: event.category,
      organizer: { name: event.organizer.user.name },
      media: event.media,
      availableTickets: event.ticketTypes.reduce((totalAvailable, ticketType) => totalAvailable + Math.max(0, ticketType.capacity - ticketType.tickets.length - ticketType.holds.reduce((sum, hold) => sum + hold.quantity, 0)), 0),
    })),
    page,
    total,
  };
}

export async function getPublicEvent({
  database,
  slug,
  now = new Date(),
}: {
  database: PrismaClient;
  slug: string;
  now?: Date;
}): Promise<{ id: string; slug: string; title: string; description: string; city: string; state: string; venue: string; address: string; timeZone: string; startAt: Date; endAt: Date; category: { name: string; slug: string }; organizer: { name: string }; media: Array<{ id: string; publicUrl: string; isCover: boolean }>; ticketTypes: Array<{ id: string; name: string; description: string | null; priceKobo: number; salesStartAt: Date | null; salesEndAt: Date | null; maxPerOrder: number | null; availableTickets: number }> } | null> {
  const event = await database.event.findFirst({
    where: { slug, status: 'PUBLISHED', organizer: { status: 'ACTIVE' }, startAt: { gt: now } },
    select: { id: true, slug: true, title: true, description: true, city: true, state: true, venue: true, address: true, timeZone: true, startAt: true, endAt: true, category: { select: { name: true, slug: true } }, organizer: { select: { user: { select: { name: true } } } }, media: { where: { status: 'READY' }, orderBy: [{ isCover: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }], select: { id: true, publicUrl: true, isCover: true } }, ticketTypes: { where: { isActive: true }, orderBy: { priceKobo: 'asc' }, select: { id: true, name: true, description: true, priceKobo: true, salesStartAt: true, salesEndAt: true, maxPerOrder: true, capacity: true, tickets: { where: { status: 'ACTIVE' }, select: { id: true } }, holds: { where: { expiresAt: { gt: now } }, select: { quantity: true } } } } },
  });
  return event ? {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    city: event.city,
    state: event.state,
    venue: event.venue,
    address: event.address,
    timeZone: event.timeZone,
    startAt: event.startAt,
    endAt: event.endAt,
    category: event.category,
    organizer: { name: event.organizer.user.name },
    media: event.media,
    ticketTypes: event.ticketTypes.map((ticketType) => ({
      id: ticketType.id,
      name: ticketType.name,
      description: ticketType.description,
      priceKobo: ticketType.priceKobo,
      salesStartAt: ticketType.salesStartAt,
      salesEndAt: ticketType.salesEndAt,
      maxPerOrder: ticketType.maxPerOrder,
      availableTickets: Math.max(0, ticketType.capacity - ticketType.tickets.length - ticketType.holds.reduce((sum, hold) => sum + hold.quantity, 0)),
    })),
  } : null;
}

export async function updateOwnedEvent({
  database,
  organizerProfileId,
  eventId,
  categoryId,
  title,
  slug,
  description,
  city,
  state,
  venue,
  address,
  timeZone,
  startAt,
  endAt,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  categoryId?: string;
  title?: string;
  slug?: string;
  description?: string;
  city?: string;
  state?: string;
  venue?: string;
  address?: string;
  timeZone?: string;
  startAt?: Date;
  endAt?: Date;
}): Promise<void> {
  const event = await findOwnedDraftEvent({ database, organizerProfileId, eventId });
  const values = { categoryId: categoryId ?? event.categoryId, title: title ?? event.title, slug: slug ?? event.slug, description: description ?? event.description, city: city ?? event.city, state: state ?? event.state, venue: venue ?? event.venue, address: address ?? event.address, timeZone: timeZone ?? event.timeZone, startAt: startAt ?? event.startAt, endAt: endAt ?? event.endAt };
  validateEventValues(values);
  await database.event.update({ where: { id: event.id }, data: { ...values, categoryId: values.categoryId.trim(), title: values.title.trim(), slug: values.slug.trim(), description: values.description.trim(), city: values.city.trim(), state: values.state.trim(), venue: values.venue.trim(), address: values.address.trim(), timeZone: values.timeZone.trim() } });
  await recordOrganizerAudit(database, organizerProfileId, 'EVENT_UPDATED', 'EVENT', event.id);
}

export async function unpublishOwnedEvent({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<void> {
  const event = await database.event.findFirst({ where: { id: eventId, organizerProfileId, status: 'PUBLISHED', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } }, select: { id: true } });
  if (!event) throw new Error('event is unavailable to this organizer');
  await database.event.update({ where: { id: event.id }, data: { status: 'DRAFT', publishedAt: null } });
  await recordOrganizerAudit(database, organizerProfileId, 'EVENT_UNPUBLISHED', 'EVENT', event.id);
}

export async function createOwnedTicketType({
  database,
  organizerProfileId,
  eventId,
  name,
  description,
  priceKobo,
  capacity,
  salesStartAt,
  salesEndAt,
  maxPerOrder,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  name: string;
  description?: string;
  priceKobo: number;
  capacity: number;
  salesStartAt?: Date;
  salesEndAt?: Date;
  maxPerOrder?: number;
}): Promise<{ id: string }> {
  await findOwnedDraftEvent({ database, organizerProfileId, eventId });
  validateTicketTypeValues({ name, description, priceKobo, capacity, salesStartAt, salesEndAt, maxPerOrder });
  const ticketType = await database.ticketType.create({ data: { eventId, name: name.trim(), description: description?.trim() || null, priceKobo, capacity, salesStartAt, salesEndAt, maxPerOrder }, select: { id: true } });
  await recordOrganizerAudit(database, organizerProfileId, 'TICKET_TYPE_CREATED', 'TICKET_TYPE', ticketType.id, { eventId });
  return ticketType;
}

export async function updateOwnedTicketType({
  database,
  organizerProfileId,
  eventId,
  ticketTypeId,
  name,
  description,
  priceKobo,
  capacity,
  salesStartAt,
  salesEndAt,
  maxPerOrder,
  isActive,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  ticketTypeId: string;
  name?: string;
  description?: string | null;
  priceKobo?: number;
  capacity?: number;
  salesStartAt?: Date | null;
  salesEndAt?: Date | null;
  maxPerOrder?: number | null;
  isActive?: boolean;
}): Promise<void> {
  const ticketType = await database.ticketType.findFirst({
    where: { id: ticketTypeId, eventId, event: { organizerProfileId, status: 'DRAFT', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    select: { id: true, name: true, description: true, priceKobo: true, capacity: true, salesStartAt: true, salesEndAt: true, maxPerOrder: true, isActive: true },
  });
  if (!ticketType) throw new Error('event is unavailable to this organizer');
  const values = { name: name ?? ticketType.name, description: description === undefined ? ticketType.description : description, priceKobo: priceKobo ?? ticketType.priceKobo, capacity: capacity ?? ticketType.capacity, salesStartAt: salesStartAt === undefined ? ticketType.salesStartAt : salesStartAt, salesEndAt: salesEndAt === undefined ? ticketType.salesEndAt : salesEndAt, maxPerOrder: maxPerOrder === undefined ? ticketType.maxPerOrder : maxPerOrder };
  validateTicketTypeValues(values);
  await database.ticketType.update({ where: { id: ticketType.id }, data: { ...values, name: values.name.trim(), description: values.description?.trim() || null, isActive: isActive ?? ticketType.isActive } });
  await recordOrganizerAudit(database, organizerProfileId, 'TICKET_TYPE_UPDATED', 'TICKET_TYPE', ticketType.id, { eventId });
}

export async function removeOwnedTicketType({
  database,
  organizerProfileId,
  eventId,
  ticketTypeId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  ticketTypeId: string;
}): Promise<void> {
  const ticketType = await database.ticketType.findFirst({
    where: { id: ticketTypeId, eventId, event: { organizerProfileId, status: 'DRAFT', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    select: { id: true, _count: { select: { orderLines: true, holds: true, tickets: true } } },
  });
  if (!ticketType || ticketType._count.orderLines || ticketType._count.holds || ticketType._count.tickets) throw new Error('ticket type cannot be removed');
  await database.ticketType.delete({ where: { id: ticketType.id } });
  await recordOrganizerAudit(database, organizerProfileId, 'TICKET_TYPE_REMOVED', 'TICKET_TYPE', ticketType.id, { eventId });
}

async function findOwnedDraftEvent({ database, organizerProfileId, eventId }: { database: PrismaClient; organizerProfileId: string; eventId: string }) {
  const event = await database.event.findFirst({ where: { id: eventId, organizerProfileId, status: 'DRAFT', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } }, select: { id: true, categoryId: true, title: true, slug: true, description: true, city: true, state: true, venue: true, address: true, timeZone: true, startAt: true, endAt: true } });
  if (!event) throw new Error('event is unavailable to this organizer');
  return event;
}

function validateEventValues(values: { categoryId: string; title: string; slug: string; description: string; city: string; state: string; venue: string; address: string; timeZone: string; startAt: Date; endAt: Date }): void {
  if (!values.categoryId.trim() || !values.title.trim() || !values.slug.trim() || !values.description.trim() || !values.city.trim() || !values.state.trim() || !values.venue.trim() || !values.address.trim() || !values.timeZone.trim() || values.startAt >= values.endAt) throw new RangeError('event details are invalid');
}

function validateTicketTypeValues(values: { name: string; description?: string | null; priceKobo: number; capacity: number; salesStartAt?: Date | null; salesEndAt?: Date | null; maxPerOrder?: number | null }): void {
  if (!values.name.trim() || !Number.isSafeInteger(values.priceKobo) || values.priceKobo < 0 || !Number.isSafeInteger(values.capacity) || values.capacity < 1 || (values.maxPerOrder !== undefined && values.maxPerOrder !== null && (!Number.isSafeInteger(values.maxPerOrder) || values.maxPerOrder < 1)) || (values.salesStartAt && values.salesEndAt && values.salesStartAt >= values.salesEndAt)) throw new RangeError('ticket type details are invalid');
}

async function recordOrganizerAudit(database: PrismaClient, actorProfileId: string, action: string, targetType: string, targetId: string, details?: Record<string, unknown>): Promise<void> {
  await database.auditLog.create({ data: { actorProfileId, action, targetType, targetId, ...(details ? { details: details as Prisma.InputJsonValue } : {}) } });
}
