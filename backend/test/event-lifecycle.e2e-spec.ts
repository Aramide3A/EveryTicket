import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type EventLifecycle = {
  cancelOwnedEvent(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  removeOwnedEvent(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
  }): Promise<void>;
};

async function loadEventLifecycle(): Promise<EventLifecycle | undefined> {
  try {
    return await import('../src/events/event-lifecycle.js') as EventLifecycle;
  } catch {
    return undefined;
  }
}

describe('event lifecycle', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      const eventIds = [ids.eventId, ids.emptyDraftEventId, ids.activeDraftEventId].filter(Boolean);
      for (const eventId of eventIds) {
        await client.$executeRaw`DELETE FROM inventory_hold WHERE "ticketTypeId" IN (SELECT id FROM ticket_type WHERE "eventId" = ${eventId})`;
        await client.$executeRaw`DELETE FROM ticket WHERE "eventId" = ${eventId}`;
        await client.$executeRaw`DELETE FROM guest WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${eventId})`;
        await client.$executeRaw`DELETE FROM guest_list WHERE "eventId" = ${eventId}`;
        await client.$executeRaw`DELETE FROM "order" WHERE "eventId" = ${eventId}`;
        await client.$executeRaw`DELETE FROM ticket_type WHERE "eventId" = ${eventId}`;
        await client.$executeRaw`DELETE FROM event WHERE id = ${eventId}`;
      }
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      for (const userId of [ids.organizerUserId, ids.otherOrganizerUserId].filter(Boolean)) {
        await client.$executeRaw`DELETE FROM auth_user WHERE id = ${userId}`;
      }
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('cancels pending purchases, releases inventory, revokes admission, and preserves paid orders', async () => {
    const lifecycle = await loadEventLifecycle();
    const databaseUrl = process.env.DATABASE_URL;
    expect(lifecycle).toBeDefined();
    if (!lifecycle || !databaseUrl) throw new Error('event lifecycle is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const cancelledAt = new Date('2031-06-01T12:00:00.000Z');

    await lifecycle.cancelOwnedEvent({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      eventId: ids.eventId,
      reason: '  Venue unavailable  ',
      now: cancelledAt,
    });

    await expect(client.event.findUniqueOrThrow({ where: { id: ids.eventId }, select: { status: true, cancelledAt: true, cancelledReason: true } })).resolves.toEqual({
      status: 'CANCELLED',
      cancelledAt,
      cancelledReason: 'Venue unavailable',
    });
    await expect(client.order.findMany({ where: { eventId: ids.eventId }, orderBy: { reference: 'asc' }, select: { reference: true, status: true } })).resolves.toEqual([
      { reference: `paid-${ids.eventId}`, status: 'PAID' },
      { reference: `pending-${ids.eventId}`, status: 'CANCELLED' },
    ]);
    expect(await client.inventoryHold.count({ where: { orderId: ids.pendingOrderId } })).toBe(0);
    await expect(client.ticket.findUniqueOrThrow({ where: { id: ids.ticketId }, select: { status: true } })).resolves.toEqual({ status: 'REVOKED' });
    await expect(client.guest.findUniqueOrThrow({ where: { id: ids.guestId }, select: { credentialStatus: true } })).resolves.toEqual({ credentialStatus: 'REVOKED' });
  });

  it('rejects cancellation by a different organizer and repeated cancellation', async () => {
    const lifecycle = await loadEventLifecycle();
    const databaseUrl = process.env.DATABASE_URL;
    expect(lifecycle).toBeDefined();
    if (!lifecycle || !databaseUrl) throw new Error('event lifecycle is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await expect(lifecycle.cancelOwnedEvent({ database: client, organizerProfileId: ids.otherOrganizerProfileId, eventId: ids.eventId, reason: 'Not mine', now: new Date() })).rejects.toThrow('event is unavailable to this organizer');
    await lifecycle.cancelOwnedEvent({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, reason: 'Cancelled', now: new Date() });
    await expect(lifecycle.cancelOwnedEvent({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, reason: 'Again', now: new Date() })).rejects.toThrow('event is unavailable to this organizer');
  });

  it('deletes only an unused owned draft and removes its unused ticket types', async () => {
    const lifecycle = await loadEventLifecycle();
    const databaseUrl = process.env.DATABASE_URL;
    expect(lifecycle).toBeDefined();
    if (!lifecycle || !databaseUrl) throw new Error('event lifecycle is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await expect(lifecycle.removeOwnedEvent({ database: client, organizerProfileId: ids.otherOrganizerProfileId, eventId: ids.emptyDraftEventId })).rejects.toThrow('event is unavailable to this organizer');
    await expect(lifecycle.removeOwnedEvent({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.activeDraftEventId })).rejects.toThrow('event has operational or financial activity');
    await expect(lifecycle.removeOwnedEvent({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId })).rejects.toThrow('event is unavailable to this organizer');

    await lifecycle.removeOwnedEvent({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.emptyDraftEventId });
    expect(await client.event.count({ where: { id: ids.emptyDraftEventId } })).toBe(0);
    expect(await client.ticketType.count({ where: { eventId: ids.emptyDraftEventId } })).toBe(0);
  });
});

async function createFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, {
    organizerUserId: randomUUID(), organizerProfileId: randomUUID(), otherOrganizerUserId: randomUUID(), otherOrganizerProfileId: randomUUID(),
    categoryId: randomUUID(), eventId: randomUUID(), emptyDraftEventId: randomUUID(), activeDraftEventId: randomUUID(),
    ticketTypeId: randomUUID(), emptyDraftTicketTypeId: randomUUID(), activeDraftTicketTypeId: randomUUID(), feeRuleId: randomUUID(),
    pendingOrderId: randomUUID(), paidOrderId: randomUUID(), ticketId: randomUUID(), guestListId: randomUUID(), guestId: randomUUID(),
  });
  for (const [userId, profileId, name] of [[ids.organizerUserId, ids.organizerProfileId, 'Owner'], [ids.otherOrganizerUserId, ids.otherOrganizerProfileId, 'Other owner']] as const) {
    await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${userId}, ${name}, ${`${userId}@example.test`}, true, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${profileId}, ${userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  }
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, 'Lifecycle', ${`lifecycle-${ids.categoryId}`}, NOW(), NOW())`;
  for (const [eventId, status, publishedAt] of [[ids.eventId, 'PUBLISHED', new Date('2031-01-01T00:00:00.000Z')], [ids.emptyDraftEventId, 'DRAFT', null], [ids.activeDraftEventId, 'DRAFT', null]] as const) {
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${eventId}, ${ids.organizerProfileId}, ${ids.categoryId}, 'Lifecycle event', ${`lifecycle-${eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', ${status}::"EventState", ${publishedAt}, NOW(), NOW())`;
  }
  for (const [ticketTypeId, eventId] of [[ids.ticketTypeId, ids.eventId], [ids.emptyDraftTicketTypeId, ids.emptyDraftEventId], [ids.activeDraftTicketTypeId, ids.activeDraftEventId]] as const) {
    await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ticketTypeId}, ${eventId}, 'General', 2000, 10, true, NOW(), NOW())`;
  }
  await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.feeRuleId}, ${Number(`8${Date.now().toString().slice(-6)}`)}, 'FIXED', 200, '2030-01-01T00:00:00.000Z', NOW())`;
  for (const [orderId, eventId, reference, status, paidAt] of [[ids.pendingOrderId, ids.eventId, `pending-${ids.eventId}`, 'PENDING_PAYMENT', null], [ids.paidOrderId, ids.eventId, `paid-${ids.eventId}`, 'PAID', new Date('2031-05-01T00:00:00.000Z')], [randomUUID(), ids.activeDraftEventId, `draft-${ids.activeDraftEventId}`, 'PENDING_PAYMENT', null]] as const) {
    await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "paidAt", "createdAt") VALUES (${orderId}, ${reference}, ${eventId}, 'Buyer', ${`${orderId}@example.test`}, 'NGN', 2000, 200, 2200, ${ids.feeRuleId}, 1, 'FIXED', 200, '2032-01-01T10:10:00.000Z', ${status}::"OrderStatus", ${paidAt}, NOW())`;
  }
  await client.$executeRaw`INSERT INTO inventory_hold (id, "orderId", "ticketTypeId", quantity, "expiresAt", "createdAt") VALUES (${randomUUID()}, ${ids.pendingOrderId}, ${ids.ticketTypeId}, 1, '2032-01-01T10:10:00.000Z', NOW())`;
  await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ids.ticketId}, ${ids.paidOrderId}, ${ids.eventId}, ${ids.ticketTypeId}, 'Attendee', 'attendee@example.test', 'General', 2000, ${`digest-${ids.ticketId}`}, NOW())`;
  await client.$executeRaw`INSERT INTO guest_list (id, "eventId", name, "createdAt", "updatedAt") VALUES (${ids.guestListId}, ${ids.eventId}, 'Guests', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO guest (id, "guestListId", name, email, "responseStatus", "credentialStatus", "admissionTokenDigest", "createdAt", "updatedAt") VALUES (${ids.guestId}, ${ids.guestListId}, 'Guest', 'guest@example.test', 'ACCEPTED', 'ACTIVE', ${`guest-${ids.guestId}`}, NOW(), NOW())`;
}
