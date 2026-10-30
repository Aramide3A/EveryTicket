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
    const registration = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Organizer', email: ids.email, password: 'password1234' })
      .expect(200);
    const setCookie = registration.headers['set-cookie'];
    cookie = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    await client.$executeRaw`UPDATE application_profile SET role = 'ORGANIZER' WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})`;
    ids.categoryId = randomUUID();
    ids.eventId = randomUUID();
    await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, 'Organizer operations', ${`organizer-operations-${ids.categoryId}`}, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})), ${ids.categoryId}, 'Organizer operations event', ${`organizer-operations-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', '2031-12-31T10:00:00.000Z', NOW(), NOW())`;
  });

  afterEach(async () => {
    if (client) {
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
});
