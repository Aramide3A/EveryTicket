import { createHash, randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';
import { createTicketCredential } from '../src/worker/ticket-credential.js';

type RsvpAdmission = {
  createGuestList(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; name: string; categories?: Array<{ name: string; isRestricted: boolean }>; maxResponses?: number; expiresAt?: Date }): Promise<{ id: string; categories: Array<{ id: string; name: string; isRestricted: boolean }> }>;
  createRsvpLink(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestListId: string; categoryId?: string; maxResponses?: number; expiresAt?: Date }): Promise<{ token: string }>;
  submitRsvpResponse(input: { database: ReturnType<typeof createDatabaseClient>; token: string; idempotencyKey: string; name: string; email: string; requestedCategoryId?: string; now: Date }): Promise<{ guestId: string; admissionToken?: string; categoryId: string | null }>;
  revokeGuest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestId: string; now: Date }): Promise<void>;
  getRsvpLink(input: { database: ReturnType<typeof createDatabaseClient>; token: string; now: Date }): Promise<{ available: boolean; guestListName?: string; fixedCategoryName?: string }>;
  listGuests(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestListId: string; query?: string; responseStatus?: 'PENDING' | 'ACCEPTED' | 'DECLINED'; credentialStatus?: 'ACTIVE' | 'REVOKED' }): Promise<Array<{ id: string; name: string; email: string; responseStatus: string; credentialStatus: string }>>;
  getCheckInSummary(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string }): Promise<{ checkedIn: number }>;
  addGuest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestListId: string; name: string; email: string; categoryId?: string; now: Date }): Promise<{ guestId: string; admissionToken: string }>;
  updateGuest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestId: string; name: string; email: string }): Promise<void>;
  removeGuest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestId: string }): Promise<void>;
  exportGuestsCsv(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; guestListId: string }): Promise<string>;
  previewAdmission(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; token: string; ticketCredentialSecret?: string }): Promise<{ code: 'VALID' | 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'UNPAID' | 'ALREADY_USED'; name?: string }>;
  confirmAdmission(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; token: string; now: Date }): Promise<{ code: 'CHECKED_IN' | 'ALREADY_USED' | 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'UNPAID'; checkedInAt?: Date }>;
};

async function loadRsvpAdmission(): Promise<RsvpAdmission | undefined> {
  try {
    const module = await import('../src/admission/rsvp-admission.js');
    return module as RsvpAdmission;
  } catch {
    return undefined;
  }
}

describe('RSVP and admission', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.eventId) {
        await client.$executeRaw`DELETE FROM check_in WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM notification_job WHERE "recipientEmail" IN ('guest@example.test', 'guest-two@example.test', 'manual@example.test', 'other@example.test', 'capacity-one@example.test', 'capacity-two@example.test')`;
        await client.$executeRaw`DELETE FROM ticket WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM "order" WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM ticket_type WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM guest WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${ids.eventId})`;
        await client.$executeRaw`DELETE FROM rsvp_link WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${ids.eventId})`;
        await client.$executeRaw`DELETE FROM guest_category WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${ids.eventId})`;
        await client.$executeRaw`DELETE FROM guest_list WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
      }
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.organizerUserId) await client.$executeRaw`DELETE FROM auth_user WHERE id = ${ids.organizerUserId}`;
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('keeps an RSVP response in its link-fixed category and issues an opaque guest credential once', async () => {
    const rsvp = await loadRsvpAdmission();
    const databaseUrl = process.env.DATABASE_URL;
    expect(rsvp).toBeDefined();
    if (!rsvp || !databaseUrl) throw new Error('RSVP admission is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const list = await rsvp.createGuestList({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      eventId: ids.eventId,
      name: 'Launch guests',
      categories: [{ name: 'General guest', isRestricted: false }, { name: 'VIP', isRestricted: true }],
    });
    expect(list.categories).toEqual([
      { id: expect.any(String), name: 'General guest', isRestricted: false },
      { id: expect.any(String), name: 'VIP', isRestricted: true },
    ]);
    const fixedCategoryId = list.categories[0].id;
    const vipCategoryId = list.categories[1].id;
    const expiresAt = new Date('2032-01-01T12:00:00.000Z');
    const link = await rsvp.createRsvpLink({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id, categoryId: fixedCategoryId, maxResponses: 2, expiresAt });
    await expect(client.rsvpLink.findFirst({ where: { guestListId: list.id }, select: { maxResponses: true, expiresAt: true } })).resolves.toEqual({ maxResponses: 2, expiresAt });

    const first = await rsvp.submitRsvpResponse({
      database: client, token: link.token, idempotencyKey: 'submission-one', name: 'Guest One', email: 'guest@example.test', requestedCategoryId: vipCategoryId, now: new Date(),
    });
    const replay = await rsvp.submitRsvpResponse({
      database: client, token: link.token, idempotencyKey: 'submission-one', name: 'Guest One', email: 'guest@example.test', requestedCategoryId: vipCategoryId, now: new Date(),
    });

    expect(first.categoryId).toBe(fixedCategoryId);
    expect(first.admissionToken).toEqual(expect.any(String));
    expect(replay).toEqual({ guestId: first.guestId, categoryId: fixedCategoryId });
    expect(await client.guest.count({ where: { guestListId: list.id } })).toBe(1);
  });

  it('allows exactly one organizer-owned gate confirmation for a guest credential', async () => {
    const rsvp = await loadRsvpAdmission();
    const databaseUrl = process.env.DATABASE_URL;
    expect(rsvp).toBeDefined();
    if (!rsvp || !databaseUrl) throw new Error('RSVP admission is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const list = await rsvp.createGuestList({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, name: 'Launch guests' });
    const link = await rsvp.createRsvpLink({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id });
    await expect(rsvp.getRsvpLink({ database: client, token: link.token, now: new Date() })).resolves.toEqual({ available: true, guestListName: 'Launch guests' });
    const guest = await rsvp.submitRsvpResponse({ database: client, token: link.token, idempotencyKey: 'submission-two', name: 'Guest Two', email: 'guest-two@example.test', now: new Date() });
    if (!guest.admissionToken) throw new Error('guest credential was not issued');

    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: guest.admissionToken })).resolves.toEqual({ code: 'VALID', name: 'Guest Two' });
    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: randomUUID(), token: guest.admissionToken })).rejects.toThrow('event is unavailable');
    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: randomUUID(), eventId: ids.eventId, token: guest.admissionToken })).rejects.toThrow('event is unavailable');
    const results = await Promise.all([
      rsvp.confirmAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: guest.admissionToken, now: new Date('2032-01-01T10:00:00.000Z') }),
      rsvp.confirmAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: guest.admissionToken, now: new Date('2032-01-01T10:00:00.000Z') }),
    ]);
    expect(results.map((result) => result.code).sort()).toEqual(['ALREADY_USED', 'CHECKED_IN']);
    expect(await client.checkIn.count({ where: { eventId: ids.eventId } })).toBe(1);
    await expect(rsvp.listGuests({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id })).resolves.toEqual([
      { id: guest.guestId, name: 'Guest Two', email: 'guest-two@example.test', responseStatus: 'ACCEPTED', credentialStatus: 'ACTIVE' },
    ]);
    await expect(rsvp.getCheckInSummary({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId })).resolves.toEqual({ checkedIn: 1 });
    await rsvp.revokeGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestId: guest.guestId, now: new Date() });
    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: guest.admissionToken })).resolves.toEqual({ code: 'REVOKED' });
  });

  it('recognizes a signed PDF ticket credential without storing a raw admission token', async () => {
    const rsvp = await loadRsvpAdmission();
    const databaseUrl = process.env.DATABASE_URL;
    expect(rsvp).toBeDefined();
    if (!rsvp || !databaseUrl) throw new Error('RSVP admission is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    await createTicketCredentials(client, ids, 'legacy-paid-token', 'legacy-unpaid-token');
    const ticket = await client.ticket.findUniqueOrThrow({ where: { id: ids.paidTicketId }, select: { id: true, admissionTokenDigest: true } });
    const secret = 'ticket-credential-secret-that-is-long-enough';
    const qrCredential = createTicketCredential({ ticketId: ticket.id, admissionTokenDigest: ticket.admissionTokenDigest, secret });

    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: qrCredential, ticketCredentialSecret: secret })).resolves.toEqual({ code: 'VALID', name: 'Paid attendee' });
  });

  it('lets the owning organizer manage guests and produces CSV that cannot execute spreadsheet formulas', async () => {
    const rsvp = await loadRsvpAdmission();
    const databaseUrl = process.env.DATABASE_URL;
    expect(rsvp).toBeDefined();
    if (!rsvp || !databaseUrl) throw new Error('RSVP admission is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const list = await rsvp.createGuestList({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, name: 'Managed guests' });
    const guest = await rsvp.addGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id, name: '=HYPERLINK("https://unsafe.test")', email: 'manual@example.test', now: new Date() });

    expect(guest.admissionToken).toEqual(expect.any(String));
    await rsvp.updateGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestId: guest.guestId, name: '=updated', email: 'manual@example.test' });
    await expect(rsvp.exportGuestsCsv({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id })).resolves.toBe(
      "name,email,responseStatus,credentialStatus\r\n'=updated,manual@example.test,ACCEPTED,ACTIVE\r\n",
    );
    const otherGuest = await rsvp.addGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id, name: 'Other guest', email: 'other@example.test', now: new Date() });
    await expect(rsvp.listGuests({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id, query: 'updated', responseStatus: 'ACCEPTED' })).resolves.toEqual([
      { id: guest.guestId, name: '=updated', email: 'manual@example.test', responseStatus: 'ACCEPTED', credentialStatus: 'ACTIVE' },
    ]);
    await rsvp.revokeGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestId: guest.guestId, now: new Date() });
    await expect(rsvp.listGuests({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id, credentialStatus: 'REVOKED' })).resolves.toEqual([
      { id: guest.guestId, name: '=updated', email: 'manual@example.test', responseStatus: 'ACCEPTED', credentialStatus: 'REVOKED' },
    ]);
    await rsvp.removeGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestId: guest.guestId });
    await rsvp.removeGuest({ database: client, organizerProfileId: ids.organizerProfileId, guestId: otherGuest.guestId });
    expect(await client.guest.count({ where: { guestListId: list.id } })).toBe(0);
  });

  it('checks in a paid ticket once and identifies an unpaid ticket without recording entry', async () => {
    const rsvp = await loadRsvpAdmission();
    const databaseUrl = process.env.DATABASE_URL;
    expect(rsvp).toBeDefined();
    if (!rsvp || !databaseUrl) throw new Error('RSVP admission is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const paidToken = randomUUID();
    const unpaidToken = randomUUID();
    await createTicketCredentials(client, ids, paidToken, unpaidToken);

    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: paidToken })).resolves.toEqual({ code: 'VALID', name: 'Paid attendee' });
    await expect(rsvp.confirmAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: paidToken, now: new Date('2032-01-01T10:00:00.000Z') })).resolves.toMatchObject({ code: 'CHECKED_IN' });
    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: paidToken })).resolves.toEqual({ code: 'ALREADY_USED' });
    await expect(rsvp.previewAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: unpaidToken })).resolves.toEqual({ code: 'UNPAID' });
    await expect(rsvp.confirmAdmission({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, token: unpaidToken, now: new Date() })).resolves.toEqual({ code: 'UNPAID' });
    expect(await client.checkIn.count({ where: { eventId: ids.eventId } })).toBe(1);
  });

  it('accepts only one concurrent RSVP when the guest-list response limit is one', async () => {
    const rsvp = await loadRsvpAdmission();
    const databaseUrl = process.env.DATABASE_URL;
    expect(rsvp).toBeDefined();
    if (!rsvp || !databaseUrl) throw new Error('RSVP admission is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const list = await rsvp.createGuestList({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, name: 'Limited guests', maxResponses: 1 });
    const link = await rsvp.createRsvpLink({ database: client, organizerProfileId: ids.organizerProfileId, guestListId: list.id });

    const results = await Promise.allSettled([
      rsvp.submitRsvpResponse({ database: client, token: link.token, idempotencyKey: 'capacity-one', name: 'Capacity one', email: 'capacity-one@example.test', now: new Date() }),
      rsvp.submitRsvpResponse({ database: client, token: link.token, idempotencyKey: 'capacity-two', name: 'Capacity two', email: 'capacity-two@example.test', now: new Date() }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await client.guest.count({ where: { guestListId: list.id } })).toBe(1);
  });
});

async function createFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { organizerUserId: randomUUID(), organizerProfileId: randomUUID(), categoryId: randomUUID(), eventId: randomUUID() });
  await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${ids.organizerUserId}, 'Organizer', ${`${ids.organizerUserId}@example.test`}, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${ids.organizerProfileId}, ${ids.organizerUserId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, ${`RSVP ${ids.categoryId}`}, ${`rsvp-${ids.categoryId}`}, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, ${ids.organizerProfileId}, ${ids.categoryId}, 'RSVP event', ${`rsvp-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', '2031-12-31T10:00:00.000Z', NOW(), NOW())`;
}

async function createTicketCredentials(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>, paidToken: string, unpaidToken: string): Promise<void> {
  Object.assign(ids, {
    ticketTypeId: randomUUID(),
    feeRuleId: randomUUID(),
    paidOrderId: randomUUID(),
    unpaidOrderId: randomUUID(),
    paidTicketId: randomUUID(),
    unpaidTicketId: randomUUID(),
  });
  await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'General', 1000, 10, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.feeRuleId}, ${Number(`8${Date.now().toString().slice(-6)}`)}, 'FIXED', 0, '2030-01-01T00:00:00.000Z', NOW())`;
  for (const [orderId, reference, status] of [[ids.paidOrderId, `paid-${ids.paidOrderId}`, 'PAID'], [ids.unpaidOrderId, `unpaid-${ids.unpaidOrderId}`, 'PENDING_PAYMENT']] as const) {
    await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "createdAt") VALUES (${orderId}, ${reference}, ${ids.eventId}, 'Attendee', ${`${orderId}@example.test`}, 'NGN', 1000, 0, 1000, ${ids.feeRuleId}, 1, 'FIXED', 0, '2032-01-01T10:10:00.000Z', ${status}, NOW())`;
  }
  for (const [ticketId, orderId, holderName, token] of [[ids.paidTicketId, ids.paidOrderId, 'Paid attendee', paidToken], [ids.unpaidTicketId, ids.unpaidOrderId, 'Unpaid attendee', unpaidToken]] as const) {
    await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ticketId}, ${orderId}, ${ids.eventId}, ${ids.ticketTypeId}, ${holderName}, ${`${ticketId}@example.test`}, 'General', 1000, ${createHash('sha256').update(token).digest('hex')}, NOW())`;
  }
}
