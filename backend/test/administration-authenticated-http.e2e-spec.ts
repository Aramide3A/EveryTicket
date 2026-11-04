import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

describe('authenticated administration HTTP contract', () => {
  let app: INestApplication | undefined;
  let client: ReturnType<typeof createDatabaseClient> | undefined;
  let cookie: string[] = [];
  let email = '';

  beforeEach(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !process.env.BETTER_AUTH_SECRET) throw new Error('identity test configuration is unavailable');
    app = await createApi();
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    email = `${randomUUID()}@example.test`;
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ name: 'Administrator', email, password: 'password1234' })
      .expect(200);
    await client.$executeRaw`UPDATE auth_user SET "emailVerified" = true WHERE email = ${email}`;
    await client.$executeRaw`UPDATE application_profile SET role = 'ADMIN' WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
    const signIn = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({ email, password: 'password1234' }).expect(200);
    const setCookie = signIn.headers['set-cookie'];
    cookie = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  });

  afterEach(async () => {
    if (client) {
      if (email) {
        await client.$executeRaw`DELETE FROM audit_log WHERE "actorProfileId" = (SELECT id FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email}))`;
        await client.$executeRaw`DELETE FROM auth_session WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
        await client.$executeRaw`DELETE FROM auth_account WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
        await client.$executeRaw`DELETE FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
        await client.$executeRaw`DELETE FROM auth_user WHERE email = ${email}`;
      }
      await client.$disconnect();
    }
    await app?.close();
    const { authDatabase } = await import('../src/identity/auth.js');
    await authDatabase.$disconnect();
    app = undefined;
    client = undefined;
    cookie = [];
    email = '';
  });

  it('returns the platform summary to a signed-in active administrator', async () => {
    const response = await request(app?.getHttpServer())
      .get('/admin/summary')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      paidOrderCount: expect.any(Number),
      totalPaidKobo: expect.any(Number),
      platformFeeRevenueKobo: expect.any(Number),
      refundLiabilityKobo: expect.any(Number),
      payoutLiabilityKobo: expect.any(Number),
    }));
  });

  it('bounds every growing administration collection with page metadata', async () => {
    const server = app?.getHttpServer();
    for (const path of ['users', 'events', 'orders', 'refund-requests', 'payout-requests']) {
      const response = await request(server).get(`/api/v1/admin/${path}?page=1&pageSize=1`).set('Cookie', cookie).expect(200);
      expect(response.body).toEqual({ items: expect.any(Array), page: 1, pageSize: 1, total: expect.any(Number) });
      expect(response.body.items.length).toBeLessThanOrEqual(1);
    }
    await request(server).get('/api/v1/admin/users?page=1&pageSize=101').set('Cookie', cookie).expect(400);
    await request(server).get('/api/v1/admin/refund-requests?status=UNKNOWN').set('Cookie', cookie).expect(400);
  });

  it('exposes provider refund execution only when Paystack is configured', async () => {
    const originalSecret = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY;
    try {
      for (const action of ['execute', 'reconcile']) {
        await request(app?.getHttpServer())
          .post(`/api/v1/admin/refund-requests/refund-not-found/${action}`)
          .set('Cookie', cookie)
          .expect(503);
      }
    } finally {
      if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = originalSecret;
    }
  });
});
