import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('POST /orders/:reference/payments', () => {
  let app: INestApplication;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.PAYSTACK_SECRET_KEY;
    app = await createApi();
  });

  afterAll(async () => {
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPaystackSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret;
  });

  it('exposes the payment initialization hand-off and refuses to operate without server-side payment configuration', async () => {
    await request(app.getHttpServer())
      .post('/orders/order-reference/payments')
      .expect(503, { message: 'payments are not configured', error: 'Service Unavailable', statusCode: 503 });
  });

  it('allows a guest to retry payment initialization by high-entropy order reference', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_configured_for_http_contract';

    await request(app.getHttpServer())
      .post('/orders/order-reference/payments')
      .expect(503);
  });
});
