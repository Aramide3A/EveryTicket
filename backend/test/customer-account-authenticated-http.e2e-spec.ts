import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

describe('authenticated customer account HTTP contract', () => {
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
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ name: 'Customer', email: ids.email, password: 'password1234' }).expect(200);
    await client.$executeRaw`UPDATE auth_user SET "emailVerified" = true WHERE email = ${ids.email}`;
    const signIn = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({ email: ids.email, password: 'password1234' }).expect(200);
    const setCookie = signIn.headers['set-cookie'];
    cookie = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    ids.categoryId = randomUUID();
    ids.eventId = randomUUID();
    ids.feeRuleId = randomUUID();
    ids.paidOrderId = randomUUID();
    ids.pendingOrderId = randomUUID();
    const feeVersion = Number(`8${Date.now().toString().slice(-6)}`);
    await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, ${`Customer account ${ids.categoryId}`}, ${`customer-account-${ids.categoryId}`}, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "createdAt", "updatedAt") VALUES (${ids.eventId}, (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})), ${ids.categoryId}, 'Customer account event', ${`customer-account-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.feeRuleId}, ${feeVersion}, 'FIXED', 0, '2030-01-01T00:00:00.000Z', NOW())`;
    for (const [id, reference, status, createdAt] of [[ids.paidOrderId, 'http-paid-order', 'PAID', '2032-01-01T10:01:00.000Z'], [ids.pendingOrderId, 'http-pending-order', 'PENDING_PAYMENT', '2032-01-01T10:02:00.000Z']] as const) {
      await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "customerProfileId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "createdAt") VALUES (${id}, ${reference}, ${ids.eventId}, (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})), 'Customer', ${ids.email}, 'NGN', 1000, 0, 1000, ${ids.feeRuleId}, ${feeVersion}, 'FIXED', 0, '2032-01-01T10:10:00.000Z', ${status}::"OrderStatus", ${createdAt}::timestamp)`;
    }
  });

  afterEach(async () => {
    if (client) {
      await client.$executeRaw`DELETE FROM "order" WHERE id IN (${ids.paidOrderId ?? ''}, ${ids.pendingOrderId ?? ''})`;
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.eventId) await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
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

  it('filters and paginates the signed-in customer order history', async () => {
    const response = await request(app?.getHttpServer()).get('/api/v1/account/orders?status=PAID&page=1&pageSize=1').set('Cookie', cookie).expect(200);

    expect(response.body).toEqual({
      items: [{
        reference: 'http-paid-order',
        status: 'PAID',
        createdAt: '2032-01-01T10:01:00.000Z',
        event: {
          title: 'Customer account event',
          startAt: '2032-01-02T10:00:00.000Z',
          venue: 'Venue',
        },
        lines: [],
        tickets: [],
      }],
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
  });

  it('rejects an invalid order-history status', async () => {
    await request(app?.getHttpServer()).get('/api/v1/account/orders?status=NOT_A_STATUS').set('Cookie', cookie).expect(400);
  });

  it('upgrades the existing customer profile to organizer without losing customer access', async () => {
    await request(app?.getHttpServer()).post('/api/v1/account/organizer').set('Cookie', cookie).expect(201);
    await request(app?.getHttpServer()).post('/api/v1/account/organizer').set('Cookie', cookie).expect(201);

    const profile = await request(app?.getHttpServer()).get('/api/v1/account/me').set('Cookie', cookie).expect(200);
    expect(profile.body).toMatchObject({ role: 'ORGANIZER', roles: ['CUSTOMER', 'ORGANIZER'], status: 'ACTIVE' });
  });
});
