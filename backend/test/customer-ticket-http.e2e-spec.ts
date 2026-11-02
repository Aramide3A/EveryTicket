import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('customer ticket HTTP access', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApi();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not expose customer orders without an authenticated session', async () => {
    await request(app.getHttpServer()).get('/customer/orders').expect(401);
  });

  it('does not expose a ticket identifier without an authenticated session', async () => {
    await request(app.getHttpServer()).get('/customer/tickets/known-ticket-id').expect(401);
  });

  it('does not allow an unauthenticated caller to request a confirmation resend', async () => {
    await request(app.getHttpServer()).post('/customer/orders/known-order/resend-confirmation').expect(401);
  });

  it('protects account data while keeping guest checkout and callback status public', async () => {
    const api = app.getHttpServer();

    await request(api).get('/api/v1/account/me').expect(401);
    await request(api).get('/api/v1/account/orders/known-order').expect(401);
    await request(api).get('/api/v1/account/tickets').expect(401);
    await request(api).get('/api/v1/account/tickets/known-ticket/download').expect(401);
    await request(api).post('/api/v1/orders/quote').send({}).expect(400);
    await request(api).get('/api/v1/orders/known-order/status').expect(503);
    await request(api).post('/api/v1/orders/known-order/reconcile').expect(503);
  });

  it('rate limits repeated public RSVP submissions', async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = '2';
    const api = app.getHttpServer();

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await request(api).post('/api/v1/rsvp/rate-limit-contract/responses').send({});
        expect(response.status).not.toBe(429);
      }
      await request(api).post('/api/v1/rsvp/rate-limit-contract/responses').send({}).expect(429);
    } finally {
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
    }
  });
});
