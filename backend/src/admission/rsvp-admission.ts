import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';
import { readTicketCredential } from '../worker/ticket-credential.js';

type AdmissionCode = 'VALID' | 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'UNPAID' | 'ALREADY_USED';

export async function createGuestList({
  database,
  organizerProfileId,
  eventId,
  name,
  categories = [],
  maxResponses,
  expiresAt,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  name: string;
  categories?: Array<{ name: string; isRestricted: boolean }>;
  maxResponses?: number;
  expiresAt?: Date;
}): Promise<{ id: string; categories: Array<{ id: string; name: string; isRestricted: boolean }> }> {
  if (!name.trim()) throw new RangeError('guest list name is required');
  validateRsvpConfiguration(maxResponses, expiresAt);
  const normalizedCategories = categories.map((category) => ({ name: category.name.trim(), isRestricted: category.isRestricted }));
  if (normalizedCategories.some((category) => !category.name) || new Set(normalizedCategories.map((category) => category.name.toLocaleLowerCase())).size !== normalizedCategories.length) {
    throw new RangeError('guest category names must be unique and non-empty');
  }
  const event = await database.event.findFirst({
    where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true },
  });
  if (!event) throw new Error('event is unavailable to this organizer');
  return database.guestList.create({
    data: {
      eventId,
      name: name.trim(),
      maxResponses,
      expiresAt,
      ...(normalizedCategories.length ? { categories: { create: normalizedCategories } } : {}),
    },
    select: { id: true, categories: { select: { id: true, name: true, isRestricted: true }, orderBy: { createdAt: 'asc' } } },
  });
}

export async function createRsvpLink({
  database,
  organizerProfileId,
  guestListId,
  categoryId,
  maxResponses,
  expiresAt,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestListId: string;
  categoryId?: string;
  maxResponses?: number;
  expiresAt?: Date;
}): Promise<{ token: string }> {
  validateRsvpConfiguration(maxResponses, expiresAt);
  const list = await database.guestList.findFirst({
    where: { id: guestListId, event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    select: { id: true },
  });
  if (!list) throw new Error('guest list is unavailable to this organizer');
  if (categoryId) {
    const category = await database.guestCategory.findFirst({ where: { id: categoryId, guestListId }, select: { id: true } });
    if (!category) throw new Error('guest category is unavailable');
  }
  const token = randomBytes(32).toString('base64url');
  await database.rsvpLink.create({
    data: { guestListId, categoryId, maxResponses, expiresAt, tokenDigest: digest(token) },
  });
  return { token };
}

export async function submitRsvpResponse({
  database,
  token,
  idempotencyKey,
  name,
  email,
  requestedCategoryId,
  now,
}: {
  database: PrismaClient;
  token: string;
  idempotencyKey: string;
  name: string;
  email: string;
  requestedCategoryId?: string;
  now: Date;
}): Promise<{ guestId: string; admissionToken?: string; categoryId: string | null }> {
  if (!name.trim() || !email.trim() || !idempotencyKey) throw new RangeError('name, email, and idempotency key are required');
  return database.$transaction(async (transaction) => {
    const previous = await transaction.guest.findUnique({
      where: { idempotencyKey },
      select: { id: true, categoryId: true },
    });
    if (previous) return { guestId: previous.id, categoryId: previous.categoryId };

    const link = await transaction.rsvpLink.findUnique({
      where: { tokenDigest: digest(token) },
      include: { guestList: { include: { categories: true } } },
    });
    if (!link || link.revokedAt || !link.guestList.isEnabled || (link.expiresAt && link.expiresAt <= now) || (link.guestList.expiresAt && link.guestList.expiresAt <= now)) {
      throw new Error('RSVP link is unavailable');
    }
    await transaction.$queryRaw`SELECT id FROM guest_list WHERE id = ${link.guestListId} FOR UPDATE`;
    const [listResponses, linkResponses] = await Promise.all([
      transaction.guest.count({ where: { guestListId: link.guestListId } }),
      transaction.guest.count({ where: { rsvpLinkId: link.id } }),
    ]);
    if ((link.guestList.maxResponses !== null && listResponses >= link.guestList.maxResponses) || (link.maxResponses !== null && linkResponses >= link.maxResponses)) {
      throw new Error('RSVP capacity is full');
    }
    const categoryId = chooseCategory(link.categoryId, requestedCategoryId, link.guestList.categories);
    const admissionToken = randomBytes(32).toString('base64url');
    const guest = await transaction.guest.create({
      data: {
        guestListId: link.guestListId,
        rsvpLinkId: link.id,
        categoryId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        responseStatus: 'ACCEPTED',
        credentialStatus: 'ACTIVE',
        admissionTokenDigest: digest(admissionToken),
        idempotencyKey,
        respondedAt: now,
      },
      select: { id: true, categoryId: true },
    });
    await transaction.notificationJob.create({
      data: {
        type: 'RSVP_CONFIRMATION',
        recipientEmail: email.trim().toLowerCase(),
        idempotencyKey: `guest:${guest.id}:confirmation`,
      },
    });
    return { guestId: guest.id, admissionToken, categoryId: guest.categoryId };
  });
}

export async function revokeGuest({
  database,
  organizerProfileId,
  guestId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestId: string;
  now: Date;
}): Promise<void> {
  const guest = await database.guest.findFirst({
    where: { id: guestId, guestList: { event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } } },
    select: { id: true },
  });
  if (!guest) throw new Error('guest is unavailable to this organizer');
  await database.guest.update({ where: { id: guest.id }, data: { credentialStatus: 'REVOKED' } });
}

export async function getRsvpLink({
  database,
  token,
  now,
}: {
  database: PrismaClient;
  token: string;
  now: Date;
}): Promise<{ available: boolean; guestListName?: string; fixedCategoryName?: string }> {
  const link = await database.rsvpLink.findUnique({
    where: { tokenDigest: digest(token) },
    select: {
      revokedAt: true,
      expiresAt: true,
      guestList: { select: { name: true, isEnabled: true, expiresAt: true } },
      category: { select: { name: true } },
    },
  });
  if (!link || link.revokedAt || !link.guestList.isEnabled || (link.expiresAt && link.expiresAt <= now) || (link.guestList.expiresAt && link.guestList.expiresAt <= now)) {
    return { available: false };
  }
  return {
    available: true,
    guestListName: link.guestList.name,
    ...(link.category ? { fixedCategoryName: link.category.name } : {}),
  };
}

export async function listGuests({
  database,
  organizerProfileId,
  guestListId,
  query,
  responseStatus,
  credentialStatus,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestListId: string;
  query?: string;
  responseStatus?: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  credentialStatus?: 'ACTIVE' | 'REVOKED';
}): Promise<Array<{ id: string; name: string; email: string; responseStatus: string; credentialStatus: string }>> {
  const list = await database.guestList.findFirst({
    where: { id: guestListId, event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    select: { id: true },
  });
  if (!list) throw new Error('guest list is unavailable to this organizer');
  const normalizedQuery = query?.trim();
  return database.guest.findMany({
    where: {
      guestListId: list.id,
      ...(responseStatus ? { responseStatus } : {}),
      ...(credentialStatus ? { credentialStatus } : {}),
      ...(normalizedQuery ? {
        OR: [
          { name: { contains: normalizedQuery, mode: 'insensitive' } },
          { email: { contains: normalizedQuery, mode: 'insensitive' } },
        ],
      } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, responseStatus: true, credentialStatus: true },
  });
}

export async function addGuest({
  database,
  organizerProfileId,
  guestListId,
  name,
  email,
  categoryId,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestListId: string;
  name: string;
  email: string;
  categoryId?: string;
  now: Date;
}): Promise<{ guestId: string; admissionToken: string }> {
  if (!name.trim() || !email.trim()) throw new RangeError('name and email are required');
  await requireOwnedGuestList(database, organizerProfileId, guestListId);
  if (categoryId) {
    const category = await database.guestCategory.findFirst({ where: { id: categoryId, guestListId }, select: { id: true } });
    if (!category) throw new Error('guest category is unavailable');
  }
  const admissionToken = randomBytes(32).toString('base64url');
  return database.$transaction(async (transaction) => {
    const guest = await transaction.guest.create({
      data: {
        guestListId,
        categoryId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        responseStatus: 'ACCEPTED',
        credentialStatus: 'ACTIVE',
        admissionTokenDigest: digest(admissionToken),
        respondedAt: now,
      },
      select: { id: true },
    });
    await transaction.notificationJob.create({
      data: { type: 'RSVP_CONFIRMATION', recipientEmail: email.trim().toLowerCase(), idempotencyKey: `guest:${guest.id}:confirmation` },
    });
    return { guestId: guest.id, admissionToken };
  });
}

export async function updateGuest({
  database,
  organizerProfileId,
  guestListId,
  guestId,
  name,
  email,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestListId?: string;
  guestId: string;
  name: string;
  email: string;
}): Promise<void> {
  if (!name.trim() || !email.trim()) throw new RangeError('name and email are required');
  const guest = await findOwnedGuest(database, organizerProfileId, guestId, guestListId);
  if (!guest) throw new Error('guest is unavailable to this organizer');
  await database.guest.update({ where: { id: guest.id }, data: { name: name.trim(), email: email.trim().toLowerCase() } });
}

export async function removeGuest({
  database,
  organizerProfileId,
  guestId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestId: string;
}): Promise<void> {
  const guest = await findOwnedGuest(database, organizerProfileId, guestId);
  if (!guest) throw new Error('guest is unavailable to this organizer');
  const checkIn = await database.checkIn.findUnique({ where: { guestId }, select: { id: true } });
  if (checkIn) throw new Error('checked-in guests must be revoked rather than removed');
  await database.$transaction([
    database.notificationJob.deleteMany({ where: { idempotencyKey: `guest:${guest.id}:confirmation` } }),
    database.guest.delete({ where: { id: guest.id } }),
  ]);
}

export async function exportGuestsCsv({
  database,
  organizerProfileId,
  guestListId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  guestListId: string;
}): Promise<string> {
  const guests = await listGuests({ database, organizerProfileId, guestListId });
  return [
    'name,email,responseStatus,credentialStatus',
    ...guests.map((guest) => [guest.name, guest.email, guest.responseStatus, guest.credentialStatus].map(csvCell).join(',')),
    '',
  ].join('\r\n');
}

export async function getCheckInSummary({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<{ checkedIn: number }> {
  const event = await database.event.findFirst({
    where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true },
  });
  if (!event) throw new Error('event is unavailable to this organizer');
  return { checkedIn: await database.checkIn.count({ where: { eventId } }) };
}

export async function previewAdmission({
  database,
  organizerProfileId,
  eventId,
  token,
  ticketCredentialSecret,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  token: string;
  ticketCredentialSecret?: string;
}): Promise<{ code: AdmissionCode; name?: string }> {
  const event = await database.event.findFirst({
    where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true },
  });
  if (!event) throw new Error('event is unavailable to this organizer');
  const credential = await findCredential(database, token, ticketCredentialSecret);
  if (!credential) return { code: 'INVALID' };
  if (credential.eventId !== eventId) return { code: 'WRONG_EVENT' };
  if (!credential.active) return { code: credential.inactiveCode };
  const existing = await database.checkIn.findFirst({
    where: credential.kind === 'guest' ? { guestId: credential.id } : { ticketId: credential.id },
    select: { checkedInAt: true },
  });
  return existing ? { code: 'ALREADY_USED' } : { code: 'VALID', name: credential.name };
}

export async function confirmAdmission({
  database,
  organizerProfileId,
  eventId,
  token,
  now,
  ticketCredentialSecret,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  token: string;
  now: Date;
  ticketCredentialSecret?: string;
}): Promise<{ code: Exclude<AdmissionCode, 'VALID'> | 'CHECKED_IN'; checkedInAt?: Date }> {
  const event = await database.event.findFirst({
    where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true },
  });
  if (!event) throw new Error('event is unavailable to this organizer');
  const credential = await findCredential(database, token, ticketCredentialSecret);
  if (!credential) return { code: 'INVALID' };
  if (credential.eventId !== eventId) return { code: 'WRONG_EVENT' };
  if (!credential.active) return { code: credential.inactiveCode };
  try {
    await database.checkIn.create({
      data: credential.kind === 'guest'
        ? { eventId, guestId: credential.id, checkedInByProfileId: organizerProfileId, checkedInAt: now }
        : { eventId, ticketId: credential.id, checkedInByProfileId: organizerProfileId, checkedInAt: now },
    });
    return { code: 'CHECKED_IN', checkedInAt: now };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await database.checkIn.findFirst({
        where: credential.kind === 'guest' ? { guestId: credential.id } : { ticketId: credential.id },
        select: { checkedInAt: true },
      });
      return { code: 'ALREADY_USED', ...(existing ? { checkedInAt: existing.checkedInAt } : {}) };
    }
    throw error;
  }
}

function chooseCategory(
  fixedCategoryId: string | null,
  requestedCategoryId: string | undefined,
  categories: Array<{ id: string; isRestricted: boolean }>,
): string | null {
  if (fixedCategoryId) return fixedCategoryId;
  if (!requestedCategoryId) return null;
  const category = categories.find(({ id }) => id === requestedCategoryId);
  if (!category || category.isRestricted) throw new Error('requested guest category is unavailable');
  return category.id;
}

async function requireOwnedGuestList(database: PrismaClient, organizerProfileId: string, guestListId: string): Promise<void> {
  const list = await database.guestList.findFirst({
    where: { id: guestListId, event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    select: { id: true },
  });
  if (!list) throw new Error('guest list is unavailable to this organizer');
}

async function findOwnedGuest(
  database: PrismaClient,
  organizerProfileId: string,
  guestId: string,
  guestListId?: string,
): Promise<{ id: string } | null> {
  return database.guest.findFirst({
    where: {
      id: guestId,
      ...(guestListId ? { guestListId } : {}),
      guestList: { event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    },
    select: { id: true },
  });
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function validateRsvpConfiguration(maxResponses: number | undefined, expiresAt: Date | undefined): void {
  if (maxResponses !== undefined && (!Number.isInteger(maxResponses) || maxResponses < 1)) {
    throw new RangeError('maximum RSVP responses must be a positive integer');
  }
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new RangeError('RSVP expiry is invalid');
}

async function findCredential(database: PrismaClient, token: string, ticketCredentialSecret?: string): Promise<
  | { kind: 'guest'; id: string; eventId: string; name: string; active: boolean; inactiveCode: 'REVOKED' }
  | { kind: 'ticket'; id: string; eventId: string; name: string; active: boolean; inactiveCode: 'REVOKED' | 'UNPAID' }
  | null
> {
  const signedTicketId = ticketCredentialSecret ? /^et1\.([^.]+)\.[A-Za-z0-9_-]+$/.exec(token)?.[1] : undefined;
  if (signedTicketId && ticketCredentialSecret) {
    const ticket = await database.ticket.findUnique({
      where: { id: signedTicketId },
      select: { id: true, holderName: true, status: true, eventId: true, admissionTokenDigest: true, order: { select: { status: true } } },
    });
    if (!ticket || readTicketCredential({ token, admissionTokenDigest: ticket.admissionTokenDigest, secret: ticketCredentialSecret }) !== ticket.id) return null;
    return ticketCredential(ticket);
  }
  const tokenDigest = digest(token);
  const guest = await database.guest.findUnique({
    where: { admissionTokenDigest: tokenDigest },
    select: { id: true, name: true, responseStatus: true, credentialStatus: true, guestList: { select: { eventId: true } } },
  });
  if (guest) {
    return {
      kind: 'guest',
      id: guest.id,
      eventId: guest.guestList.eventId,
      name: guest.name,
      active: guest.responseStatus === 'ACCEPTED' && guest.credentialStatus === 'ACTIVE',
      inactiveCode: 'REVOKED',
    };
  }
  const ticket = await database.ticket.findUnique({
    where: { admissionTokenDigest: tokenDigest },
    select: { id: true, holderName: true, status: true, eventId: true, order: { select: { status: true } } },
  });
  if (!ticket) return null;
  return ticketCredential(ticket);
}

function ticketCredential(ticket: { id: string; holderName: string; status: 'ACTIVE' | 'REVOKED'; eventId: string; order: { status: string } }): { kind: 'ticket'; id: string; eventId: string; name: string; active: boolean; inactiveCode: 'REVOKED' | 'UNPAID' } {
  return {
    kind: 'ticket',
    id: ticket.id,
    eventId: ticket.eventId,
    name: ticket.holderName,
    active: ticket.status === 'ACTIVE' && ticket.order.status === 'PAID',
    inactiveCode: ticket.order.status === 'PAID' ? 'REVOKED' : 'UNPAID',
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
