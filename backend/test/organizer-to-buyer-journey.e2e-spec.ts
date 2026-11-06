import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

const describeIsolatedJourney = process.env.RUN_ISOLATED_JOURNEY === '1' ? describe : describe.skip;

describeIsolatedJourney('organizer-to-buyer HTTP journey', () => {
  let app: INestApplication | undefined;
  let database: ReturnType<typeof createDatabaseClient> | undefined;

  it('lets an organizer publish a free event which a signed-in customer can claim', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !process.env.BETTER_AUTH_SECRET) throw new Error('journey test configuration is unavailable');

    const suffix = randomUUID();
    const organizerEmail = `organizer-${suffix}@example.test`;
    const buyerEmail = `buyer-${suffix}@example.test`;
    const categoryId = randomUUID();
    const feeRuleId = randomUUID();
    const slug = `audit-journey-${suffix}`;
    database = createDatabaseClient(databaseUrl);
    await database.$connect();
    await database.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${categoryId}, ${`Audit ${suffix}`}, ${`audit-${suffix}`}, NOW(), NOW())`;
    const activeFeeRule = await database.platformFeeRule.findFirst({
      where: { activeFrom: { lte: new Date() }, OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }] },
      select: { id: true },
    });
    if (!activeFeeRule) {
      await database.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "activeUntil", "createdAt") VALUES (${feeRuleId}, ${Number(`7${Date.now().toString().slice(-6)}`)}, 'FIXED', 0, '2020-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', NOW())`;
    }
    app = await createApi();
    const server = app.getHttpServer();

    await request(server).post('/api/v1/organizer-registration').send({ name: 'Audit organizer', email: organizerEmail, password: 'password1234' }).expect(201);
    await database.$executeRaw`UPDATE auth_user SET "emailVerified" = true WHERE email = ${organizerEmail}`;
    const organizerLogin = await request(server).post('/api/auth/sign-in/email').send({ email: organizerEmail, password: 'password1234' }).expect(200);
    const organizerCookies = cookies(organizerLogin.headers['set-cookie']);

    const event = await request(server).post('/api/v1/organizer/events').set('Cookie', organizerCookies).send({
      categoryId,
      title: 'Audit journey event',
      slug,
      description: 'A complete authenticated HTTP journey.',
      city: 'Lagos',
      state: 'Lagos',
      venue: 'Audit venue',
      address: 'Audit address',
      timeZone: 'Africa/Lagos',
      startAt: '2032-06-01T10:00:00.000Z',
      endAt: '2032-06-01T12:00:00.000Z',
    }).expect(201);

    const ticketType = await request(server).post(`/api/v1/organizer/events/${event.body.id}/ticket-types`).set('Cookie', organizerCookies).send({
      name: 'Free admission',
      priceKobo: 0,
      capacity: 5,
      maxPerOrder: 2,
    }).expect(201);
    await request(server).post(`/api/v1/organizer/events/${event.body.id}/publish`).set('Cookie', organizerCookies).expect(201);

    const publicEvent = await request(server).get(`/api/v1/events/${slug}`).expect(200);
    expect(publicEvent.body.ticketTypes).toEqual(expect.arrayContaining([expect.objectContaining({ id: ticketType.body.id, availableTickets: 5 })]));

    await request(server).post('/api/auth/sign-up/email').send({ name: 'Audit buyer', email: buyerEmail, password: 'password1234' }).expect(200);
    await database.$executeRaw`UPDATE auth_user SET "emailVerified" = true WHERE email = ${buyerEmail}`;
    const buyerLogin = await request(server).post('/api/auth/sign-in/email').send({ email: buyerEmail, password: 'password1234' }).expect(200);
    const buyerCookies = cookies(buyerLogin.headers['set-cookie']);

    await request(server).post('/api/v1/orders/quote').send({ eventId: event.body.id, items: [{ ticketTypeId: ticketType.body.id, quantity: 1 }] }).expect(201).expect(({ body }) => {
      expect(body).toMatchObject({ ticketSubtotalKobo: 0, platformFeeKobo: 0, totalKobo: 0 });
    });
    const order = await request(server).post('/api/v1/orders').send({
      eventId: event.body.id,
      buyer: { name: 'Audit buyer', email: buyerEmail },
      items: [{ ticketTypeId: ticketType.body.id, quantity: 1 }],
    }).expect(201);
    expect(order.body).toMatchObject({ status: 'PAID', totalKobo: 0 });

    const orders = await request(server).get('/api/v1/account/orders').set('Cookie', buyerCookies).expect(200);
    expect(orders.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ reference: order.body.reference, status: 'PAID' })]));
    const tickets = await request(server).get('/api/v1/account/tickets').set('Cookie', buyerCookies).expect(200);
    expect(tickets.body).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({ title: 'Audit journey event' }), ticketTypeName: 'Free admission' })]));

    await app.close();
    await database.$disconnect();
    const { authDatabase } = await import('../src/identity/auth.js');
    await authDatabase.$disconnect();
    app = undefined;
    database = undefined;
  }, 30_000);
});

function cookies(value: string[] | string | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}
