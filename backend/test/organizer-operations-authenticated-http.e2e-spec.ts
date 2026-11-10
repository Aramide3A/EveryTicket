import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

describe('authenticated organizer operations HTTP contract', () => {
  let app: INestApplication | undefined;
  let client: ReturnType<typeof createDatabaseClient> | undefined;
  const ids: Record<string, string> = {};
  let cookie: string[] = [];

  beforeEach(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !process.env.BETTER_AUTH_SECRET) throw new Error('identity test configuration is unavailable');
    app = await createApi();
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    ids.email = `${randomUUID()}@example.test`;
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Organizer', email: ids.email, password: 'password1234' })
      .expect(200);
    await client.$executeRaw`UPDATE auth_user SET "emailVerified" = true WHERE email = ${ids.email}`;
    await client.$executeRaw`UPDATE application_profile SET role = 'ORGANIZER' WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})`;
    const signIn = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({ email: ids.email, password: 'password1234' }).expect(200);
    const setCookie = signIn.headers['set-cookie'];
    cookie = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    ids.categoryId = randomUUID();
    ids.eventId = randomUUID();
    await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, 'Organizer operations', ${`organizer-operations-${ids.categoryId}`}, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})), ${ids.categoryId}, 'Organizer operations event', ${`organizer-operations-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', '2031-12-31T10:00:00.000Z', NOW(), NOW())`;
  });

  afterEach(async () => {
    if (client) {
      if (ids.eventId) {
        await client.$executeRaw`DELETE FROM event_media WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM ticket WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM "order" WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM ticket_type WHERE "eventId" = ${ids.eventId}`;
      }
      for (const eventId of [ids.eventId, ids.draftEventId].filter(Boolean)) await client.$executeRaw`DELETE FROM event WHERE id = ${eventId}`;
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      if (ids.email) {
        await client.$executeRaw`DELETE FROM auth_session WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})`;
        await client.$executeRaw`DELETE FROM auth_account WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})`;
        await client.$executeRaw`DELETE FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})`;
        await client.$executeRaw`DELETE FROM auth_user WHERE email = ${ids.email}`;
      }
      await client.$disconnect();
    }
    await app?.close();
    const { authDatabase } = await import('../src/identity/auth.js');
    await authDatabase.$disconnect();
    app = undefined;
    client = undefined;
    cookie = [];
    Object.keys(ids).forEach((key) => delete ids[key]);
  });

  it('returns the owned event dashboard to a signed-in organizer', async () => {
    const response = await request(app?.getHttpServer())
      .get(`/organizer/events/${ids.eventId}/dashboard`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toMatchObject({
      confirmedTicketsSold: 0,
      remainingCapacity: 0,
      ticketSubtotalKobo: 0,
      platformFeeKobo: 0,
      totalPaidKobo: 0,
      refundsRecordedKobo: 0,
      payableKobo: 0,
      ticketCheckIns: 0,
      guestCheckIns: 0,
      salesByTicketType: [],
    });
  });

  it('returns empty check-in history for the signed-in owner event', async () => {
    await request(app?.getHttpServer())
      .get(`/api/v1/organizer/events/${ids.eventId}/check-ins`)
      .set('Cookie', cookie)
      .expect(200, []);
  });

  it('returns category identifiers that can be submitted during event creation', async () => {
    const response = await request(app?.getHttpServer()).get('/api/v1/categories').expect(200);

    expect(response.body).toContainEqual(expect.objectContaining({ id: ids.categoryId, name: 'Organizer operations' }));
  });

  it('returns the signed-in organizer event media library', async () => {
    await request(app?.getHttpServer())
      .get(`/api/v1/organizer/events/${ids.eventId}/media`)
      .set('Cookie', cookie)
      .expect(200, []);
  });

  it('returns ready event images with the organizer event detail', async () => {
    if (!client) throw new Error('database client is unavailable');
    const readyMediaId = randomUUID();
    await client.eventMedia.createMany({ data: [
      { id: readyMediaId, eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/cover.png`, publicUrl: 'https://media.example.test/cover.png', contentType: 'image/png', contentLength: 1024, status: 'READY', isCover: true, expiresAt: new Date('2032-01-02T10:15:00.000Z'), completedAt: new Date() },
      { id: randomUUID(), eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/pending.png`, publicUrl: 'https://media.example.test/pending.png', contentType: 'image/png', contentLength: 1024, status: 'PENDING', expiresAt: new Date('2032-01-02T10:15:00.000Z') },
    ] });

    const response = await request(app?.getHttpServer())
      .get(`/api/v1/organizer/events/${ids.eventId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      id: ids.eventId,
      media: [{ id: readyMediaId, publicUrl: 'https://media.example.test/cover.png', isCover: true }],
    }));
  });

  it('returns ready event images with the organizer event list', async () => {
    if (!client) throw new Error('database client is unavailable');
    const readyMediaId = randomUUID();
    await client.eventMedia.create({
      data: { id: readyMediaId, eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/card.png`, publicUrl: 'https://media.example.test/card.png', contentType: 'image/png', contentLength: 1024, status: 'READY', isCover: true, expiresAt: new Date('2032-01-02T10:15:00.000Z'), completedAt: new Date() },
    });

    const response = await request(app?.getHttpServer())
      .get('/api/v1/organizer/events')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.eventId, media: [{ id: readyMediaId, publicUrl: 'https://media.example.test/card.png', isCover: true }] }),
    ]));
  });

  it('lets the signed-in owner cancel a published event with an explicit reason', async () => {
    if (!client) throw new Error('database client is unavailable');
    await request(app?.getHttpServer())
      .post(`/api/v1/organizer/events/${ids.eventId}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: '  Venue unavailable  ' })
      .expect(201, { cancelled: true });

    await expect(client.event.findUniqueOrThrow({ where: { id: ids.eventId }, select: { status: true, cancelledReason: true } })).resolves.toEqual({ status: 'CANCELLED', cancelledReason: 'Venue unavailable' });
  });

  it('lets the signed-in owner delete an unused draft event', async () => {
    if (!client) throw new Error('database client is unavailable');
    ids.draftEventId = randomUUID();
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "createdAt", "updatedAt") VALUES (${ids.draftEventId}, (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})), ${ids.categoryId}, 'Disposable draft', ${`disposable-${ids.draftEventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'DRAFT', NOW(), NOW())`;

    await request(app?.getHttpServer())
      .delete(`/api/v1/organizer/events/${ids.draftEventId}`)
      .set('Cookie', cookie)
      .expect(200, { removed: true });

    await expect(client.event.count({ where: { id: ids.draftEventId } })).resolves.toBe(0);
  });

  it('returns owned paid-order tickets and refund limits to the signed-in organizer', async () => {
    if (!client) throw new Error('database client is unavailable');
    Object.assign(ids, { feeRuleId: randomUUID(), ticketTypeId: randomUUID(), orderId: randomUUID(), ticketId: randomUUID() });
    await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.feeRuleId}, ${Number(`9${Date.now().toString().slice(-6)}`)}, 'FIXED', 200, '2030-01-01T00:00:00.000Z', NOW())`;
    await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'General', 2000, 10, true, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "paidAt", "createdAt") VALUES (${ids.orderId}, ${`http-${ids.orderId}`}, ${ids.eventId}, 'Buyer', 'buyer@example.test', 'NGN', 2000, 200, 2200, ${ids.feeRuleId}, 1, 'FIXED', 200, '2032-01-01T10:10:00.000Z', 'PAID', NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ids.ticketId}, ${ids.orderId}, ${ids.eventId}, ${ids.ticketTypeId}, 'Attendee', 'attendee@example.test', 'General', 2000, ${`digest-${ids.ticketId}`}, NOW())`;

    const response = await request(app?.getHttpServer())
      .get(`/api/v1/organizer/orders/${ids.orderId}/refund-inputs`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toMatchObject({ id: ids.orderId, maxPlatformFeeRefundKobo: 200, tickets: [{ id: ids.ticketId, eligible: true, maxTicketRefundKobo: 2000 }] });
  });

  it('bounds every growing organizer collection with page metadata', async () => {
    const server = app?.getHttpServer();
    for (const path of [`events/${ids.eventId}/orders`, `events/${ids.eventId}/attendees`, 'refund-requests', 'payout-requests']) {
      const response = await request(server).get(`/api/v1/organizer/${path}?page=1&pageSize=1`).set('Cookie', cookie).expect(200);
      expect(response.body).toEqual({ items: expect.any(Array), page: 1, pageSize: 1, total: expect.any(Number) });
      expect(response.body.items.length).toBeLessThanOrEqual(1);
    }
    await request(server).get(`/api/v1/organizer/events/${ids.eventId}/orders?pageSize=101`).set('Cookie', cookie).expect(400);
    await request(server).get(`/api/v1/organizer/events/${ids.eventId}/orders?status=UNKNOWN`).set('Cookie', cookie).expect(400);
    await request(server).get(`/api/v1/organizer/events/${ids.eventId}/attendees?kind=UNKNOWN`).set('Cookie', cookie).expect(400);
  });
});
