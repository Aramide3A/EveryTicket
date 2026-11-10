import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

const routes = ['events', 'users', 'orders', 'refund-requests', 'payout-requests', 'platform-fee-rule', 'audit-logs'];

describe('administration record detail contracts', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDatabaseClient>;
  let cookie: string[];
  const prefix = `detail-${randomUUID()}`;
  const id = (name: string) => `${prefix}-${name}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error('isolated identity test configuration is required');
    db = createDatabaseClient(process.env.DATABASE_URL);
    app = await createApi();
    const email = `${prefix}@example.test`;
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ name: 'Detail administrator', email, password: 'password1234' }).expect(200);
    const user = await db.auth_user.findUniqueOrThrow({ where: { email } });
    await db.auth_user.update({ where: { id: user.id }, data: { emailVerified: true } });
    await db.applicationProfile.update({ where: { userId: user.id }, data: { id: id('admin'), role: 'CUSTOMER', roles: ['CUSTOMER', 'ADMIN'] } });
    const signIn = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({ email, password: 'password1234' }).expect(200);
    const setCookie = signIn.headers['set-cookie'];
    cookie = Array.isArray(setCookie) ? setCookie : [setCookie];
    await db.auth_user.create({ data: { id: id('organizer-user'), name: 'Blocked organizer', email: `${prefix}-org@example.test`, updatedAt: new Date() } });
    await db.applicationProfile.create({ data: { id: id('organizer'), userId: id('organizer-user'), role: 'ORGANIZER', roles: ['ORGANIZER'], status: 'BLOCKED', blockedByProfileId: id('admin'), blockedAt: new Date(), blockReason: 'test' } });
    await db.eventCategory.create({ data: { id: id('category'), name: prefix, slug: prefix } });
    await db.platformFeeRule.createMany({ data: [
      { id: id('rule'), version: 900001, mode: 'FIXED', fixedAmountKobo: 50, activeFrom: new Date('2001-01-01'), activeUntil: new Date('2002-01-01'), changedByProfileId: id('admin') },
      { id: id('scheduled'), version: 900002, mode: 'FIXED', fixedAmountKobo: 0, activeFrom: new Date('2099-01-01') },
    ] });
    for (const status of ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED'] as const) {
      await db.event.create({ data: { id: id(status), organizerProfileId: id('organizer'), categoryId: id('category'), title: `Detail ${status}`, slug: id(status), description: 'Rich description', city: 'Lagos', state: 'Lagos', venue: 'Hall', address: 'Address', timeZone: 'Africa/Lagos', startAt: new Date('2001-01-01'), endAt: new Date('2001-01-02'), status } });
    }
    await db.ticketType.create({ data: { id: id('type'), eventId: id('DRAFT'), name: 'VIP', priceKobo: 1000, capacity: 10, maxPerOrder: 2 } });
    for (const status of ['READY', 'PENDING'] as const) {
      await db.eventMedia.create({ data: { id: id(status), eventId: id('DRAFT'), objectKey: id(`secret-${status}`), publicUrl: `https://media.example.test/${status}.png`, contentType: 'image/png', contentLength: 123, status, expiresAt: new Date('2099-01-01') } });
    }
    await db.order.create({ data: { id: id('order'), reference: id('ORDER'), eventId: id('DRAFT'), buyerName: 'Guest buyer', buyerEmail: 'guest@example.test', buyerPhone: '08000000000', guestAccessTokenDigest: id('secret-guest'), currency: 'NGN', ticketSubtotalKobo: 1000, platformFeeKobo: 50, totalKobo: 1050, platformFeeRuleId: id('rule'), platformFeeRuleVersion: 900001, platformFeeMode: 'FIXED', platformFeeFixedAmountKobo: 50, holdExpiresAt: new Date('2030-01-01'), status: 'PAID', paidAt: new Date(), lines: { create: { ticketTypeId: id('type'), ticketTypeName: 'VIP', unitPriceKobo: 1000, quantity: 1 } }, paymentAttempts: { create: [
      { reference: id('PAY-1'), expectedAmountKobo: 1050, currency: 'NGN', status: 'VERIFIED_FAILED', failureDetail: 'Declined', initializedAt: new Date(), verifiedAt: new Date() },
      { reference: id('PAY-2'), expectedAmountKobo: 1050, currency: 'NGN', status: 'VERIFIED_SUCCESS' },
    ] } } });
    await db.ticket.create({ data: { id: id('ticket'), orderId: id('order'), eventId: id('DRAFT'), ticketTypeId: id('type'), holderName: 'Guest buyer', holderEmail: 'guest@example.test', ticketTypeName: 'VIP', priceKobo: 1000, admissionTokenDigest: id('secret-admission') } });
    await db.refundRequest.create({ data: { id: id('refund'), organizerProfileId: id('organizer'), eventId: id('DRAFT'), orderId: id('order'), ticketRefundKobo: 1000, platformFeeRefundKobo: 0, totalRefundKobo: 1000, reason: 'Selected ticket', reviewedByProfileId: id('admin'), reviewedAt: new Date(), tickets: { create: { ticketId: id('ticket') } } } });
    await db.payoutRequest.create({ data: { id: id('payout'), organizerProfileId: id('organizer'), eventId: id('DRAFT'), ticketSubtotalKobo: 1000, reservedRefundKobo: 100, priorPaidKobo: 200, requestedAmountKobo: 700, calculatedPayableKobo: 700 } });
    await db.auditLog.create({ data: { id: id('audit'), actorProfileId: id('admin'), action: 'DETAIL_TEST', targetType: 'EVENT', targetId: id('DRAFT'), details: { enabled: false, count: 0 } } });
  }, 60000);

  afterAll(async () => {
    if (db) {
      await db.refundRequestTicket.deleteMany({ where: { refundRequestId: id('refund') } });
      await db.refundRequest.deleteMany({ where: { id: id('refund') } });
      await db.payoutRequest.deleteMany({ where: { id: id('payout') } });
      await db.auditLog.deleteMany({ where: { id: id('audit') } });
      await db.ticket.deleteMany({ where: { id: id('ticket') } });
      await db.paymentAttempt.deleteMany({ where: { orderId: id('order') } });
      await db.orderLine.deleteMany({ where: { orderId: id('order') } });
      await db.order.deleteMany({ where: { id: id('order') } });
      await db.eventMedia.deleteMany({ where: { eventId: id('DRAFT') } });
      await db.ticketType.deleteMany({ where: { id: id('type') } });
      await db.event.deleteMany({ where: { id: { in: ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED'].map(id) } } });
      await db.eventCategory.deleteMany({ where: { id: id('category') } });
      await db.platformFeeRule.deleteMany({ where: { id: { in: [id('rule'), id('scheduled')] } } });
      await db.applicationProfile.deleteMany({ where: { id: id('organizer') } });
      const admin = await db.applicationProfile.findUnique({ where: { id: id('admin') } });
      if (admin) await db.auth_user.delete({ where: { id: admin.userId } });
      await db.auth_user.deleteMany({ where: { id: id('organizer-user') } });
      await db.$disconnect();
    }
    await app?.close();
    const { authDatabase } = await import('../src/identity/auth.js');
    await authDatabase.$disconnect();
  });

  async function detail(path: string, recordId: string) {
    const result = await request(app.getHttpServer()).get(`/api/v1/admin/${path}/${recordId}`).set('Cookie', cookie).expect(200);
    expect(result.body.id).toBe(recordId);
    expect(result.body.items).toBeUndefined();
    const serialized = JSON.stringify(result.body);
    for (const sensitive of ['password', 'session', 'guestAccessTokenDigest', 'admissionTokenDigest', 'objectKey', 'providerPayload', 'secret-guest', 'secret-admission', 'secret-READY']) expect(serialized).not.toContain(sensitive);
    return result.body;
  }

  it('reads all event states regardless of age or organizer blocking and exposes only ready media', async () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED']) {
      const event = await detail('events', id(status));
      expect(event.status).toBe(status);
      expect(event.organizer).toMatchObject({ id: id('organizer'), role: 'ORGANIZER', roles: ['ORGANIZER'], user: { name: 'Blocked organizer' } });
      expect(event.description).toBe('Rich description');
    }
    const event = await detail('events', id('DRAFT'));
    expect(event.ticketTypes[0]).toMatchObject({ name: 'VIP', capacity: 10, maxPerOrder: 2 });
    expect(event.media).toHaveLength(1);
    expect(event.media[0]).toMatchObject({ publicUrl: 'https://media.example.test/READY.png' });
    await request(app.getHttpServer()).get(`/admin/events/${id('DRAFT')}`).set('Cookie', cookie).expect(200);
  });

  it('returns profile blocking identity and roles, guest order lines and all payment attempts', async () => {
    const profile = await detail('users', id('organizer'));
    expect(profile.blockedBy).toMatchObject({ id: id('admin'), roles: ['CUSTOMER', 'ADMIN'] });
    expect((await detail('users', id('admin'))).blockedBy).toBeNull();
    const order = await detail('orders', id('order'));
    expect(order).toMatchObject({ buyerPhone: '08000000000', currency: 'NGN', ticketSubtotalKobo: 1000, platformFeeKobo: 50, platformFeeRuleVersion: 900001, customerProfile: null });
    expect(order.lines[0]).toMatchObject({ ticketTypeName: 'VIP', quantity: 1, unitPriceKobo: 1000 });
    expect(order.paymentAttempts).toHaveLength(2);
    expect(order.paymentAttempts).toContainEqual(expect.objectContaining({ failureDetail: 'Declined', verifiedAt: expect.any(String) }));
  });

  it('includes refund selections, review identities and stored payout breakdowns', async () => {
    const refund = await detail('refund-requests', id('refund'));
    expect(refund.reviewer.id).toBe(id('admin'));
    expect(refund.order).toMatchObject({ buyerName: 'Guest buyer', ticketSubtotalKobo: 1000, platformFeeKobo: 50, totalKobo: 1050 });
    expect(refund.tickets).toEqual([{ ticketId: id('ticket'), ticket: { id: id('ticket'), holderName: 'Guest buyer', ticketTypeName: 'VIP', priceKobo: 1000, status: 'ACTIVE' } }]);
    const payout = await detail('payout-requests', id('payout'));
    expect(payout).toMatchObject({ ticketSubtotalKobo: 1000, reservedRefundKobo: 100, priorPaidKobo: 200, calculatedPayableKobo: 700, reviewer: null, reviewedAt: null });
  });

  it('reads historical and scheduled fee versions and nullable audit identities', async () => {
    expect(await detail('platform-fee-rule', id('rule'))).toMatchObject({ version: 900001, changedBy: { id: id('admin') } });
    expect(await detail('platform-fee-rule', id('scheduled'))).toMatchObject({ version: 900002, changedBy: null });
    expect(await detail('audit-logs', id('audit'))).toMatchObject({ actor: { id: id('admin') }, details: { enabled: false, count: 0 } });
    await db.auditLog.update({ where: { id: id('audit') }, data: { actorProfileId: null } });
    expect((await detail('audit-logs', id('audit'))).actor).toBeNull();
  });

  it('returns 404 for every missing ID and rejects anonymous, non-admin and blocked profiles first', async () => {
    for (const path of routes) {
      await request(app.getHttpServer()).get(`/api/v1/admin/${path}/missing`).set('Cookie', cookie).expect(404);
      await request(app.getHttpServer()).get(`/api/v1/admin/${path}/missing`).expect(401);
    }
    try {
      for (const data of [{ roles: ['CUSTOMER'] as const }, { roles: ['CUSTOMER', 'ADMIN'] as const, status: 'BLOCKED' as const }]) {
        await db.applicationProfile.update({ where: { id: id('admin') }, data: { ...data, roles: [...data.roles] } });
        for (const path of routes) await request(app.getHttpServer()).get(`/api/v1/admin/${path}/missing`).set('Cookie', cookie).expect(401);
      }
    } finally {
      await db.applicationProfile.update({ where: { id: id('admin') }, data: { roles: ['CUSTOMER', 'ADMIN'], status: 'ACTIVE' } });
    }
  });

  it('documents all seven single-object response contracts and errors', async () => {
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    for (const path of routes) {
      const key = Object.keys(docs.body.paths).find((key) => key.includes(`/admin/${path}/{`));
      expect(key).toBeDefined();
      const get = docs.body.paths[key as string].get;
      expect(Object.keys(get.responses)).toEqual(expect.arrayContaining(['200', '401', '404', '503']));
      expect(get.responses['200'].content['application/json'].schema.type).toBe('object');
    }
  });
});
