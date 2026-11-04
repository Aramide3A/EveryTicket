import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

describe('authenticated RSVP HTTP contracts', () => {
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
    await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, 'Authenticated RSVP', ${`authenticated-rsvp-${ids.categoryId}`}, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${ids.email})), ${ids.categoryId}, 'Authenticated RSVP event', ${`authenticated-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', '2031-12-31T10:00:00.000Z', NOW(), NOW())`;
  });

  afterEach(async () => {
    if (client) {
      await client.$executeRaw`DELETE FROM notification_job WHERE "recipientEmail" IN ('declining@example.test', 'recover-http@example.test')`;
      if (ids.eventId) {
        await client.$executeRaw`DELETE FROM guest WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${ids.eventId})`;
        await client.$executeRaw`DELETE FROM rsvp_link WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${ids.eventId})`;
        await client.$executeRaw`DELETE FROM guest_category WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" = ${ids.eventId})`;
        await client.$executeRaw`DELETE FROM guest_list WHERE "eventId" = ${ids.eventId}`;
        await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
      }
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

  it('lets the authenticated owning organizer create a configured guest list', async () => {
    const response = await request(app?.getHttpServer())
      .post(`/organizer/events/${ids.eventId}/guest-lists`)
      .set('Cookie', cookie)
      .send({
        name: 'VIP launch list',
        maxResponses: 12,
        expiresAt: '2032-01-01T12:00:00.000Z',
        categories: [{ name: 'General', isRestricted: false }, { name: 'VIP', isRestricted: true }],
      })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      categories: [
        { id: expect.any(String), name: 'General', isRestricted: false },
        { id: expect.any(String), name: 'VIP', isRestricted: true },
      ],
    });
  });

  it('lets the authenticated owner reopen event guest lists with stable identifiers', async () => {
    const created = await request(app?.getHttpServer())
      .post(`/api/v1/organizer/events/${ids.eventId}/guest-lists`)
      .set('Cookie', cookie)
      .send({ name: 'Reopen me', categories: [{ name: 'VIP', isRestricted: true }] })
      .expect(201);

    const response = await request(app?.getHttpServer())
      .get(`/api/v1/organizer/events/${ids.eventId}/guest-lists`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toEqual([expect.objectContaining({
      id: created.body.id,
      name: 'Reopen me',
      responseCount: 0,
      categories: [{ id: created.body.categories[0].id, name: 'VIP', isRestricted: true }],
    })]);
  });

  it('records an explicit public RSVP decline without issuing admission', async () => {
    const list = await request(app?.getHttpServer())
      .post(`/api/v1/organizer/events/${ids.eventId}/guest-lists`)
      .set('Cookie', cookie)
      .send({ name: 'Public decisions' })
      .expect(201);
    const link = await request(app?.getHttpServer())
      .post(`/api/v1/organizer/guest-lists/${list.body.id}/links`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);

    const response = await request(app?.getHttpServer())
      .post(`/api/v1/rsvp/${link.body.token}/responses`)
      .send({ idempotencyKey: 'http-decline', name: 'Declining guest', email: 'declining@example.test', responseStatus: 'DECLINED' })
      .expect(201);

    expect(response.body).toEqual({ guestId: expect.any(String), responseStatus: 'DECLINED', categoryId: null });
    await expect(client?.guest.findUniqueOrThrow({ where: { id: response.body.guestId }, select: { responseStatus: true, admissionTokenDigest: true } })).resolves.toEqual({ responseStatus: 'DECLINED', admissionTokenDigest: null });
  });

  it('lets the authenticated owner reissue an accepted guest credential', async () => {
    const list = await request(app?.getHttpServer()).post(`/api/v1/organizer/events/${ids.eventId}/guest-lists`).set('Cookie', cookie).send({ name: 'Recovery' }).expect(201);
    const link = await request(app?.getHttpServer()).post(`/api/v1/organizer/guest-lists/${list.body.id}/links`).set('Cookie', cookie).send({}).expect(201);
    const guest = await request(app?.getHttpServer()).post(`/api/v1/rsvp/${link.body.token}/responses`).send({ idempotencyKey: 'http-recovery', name: 'Recover me', email: 'recover-http@example.test', responseStatus: 'ACCEPTED' }).expect(201);

    const response = await request(app?.getHttpServer())
      .post(`/api/v1/organizer/guests/${guest.body.guestId}/credential/reissue`)
      .set('Cookie', cookie)
      .expect(201);

    expect(response.body).toEqual({ admissionToken: expect.any(String) });
    expect(response.body.admissionToken).not.toBe(guest.body.admissionToken);
  });
});
