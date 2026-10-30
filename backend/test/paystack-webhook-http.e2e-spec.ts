import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('POST /webhooks/paystack', () => {
  let app: INestApplication;
  const originalSecret = process.env.PAYSTACK_SECRET_KEY;
  const secret = 'test-paystack-webhook-secret';

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = secret;
    app = await createApi();
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  });

  it('rejects unsigned requests before touching payment state', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('content-type', 'application/json')
      .send('{"event":"charge.success","data":{"reference":"pay-http"}}')
      .expect(401);
  });

  it('accepts a valid non-payment event from its unmodified raw body', async () => {
    const rawBody = '{"event":"transfer.success","data":{"reference":"ignored"}}';
    const signature = createHmac('sha512', secret).update(rawBody).digest('hex');

    await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('content-type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(rawBody)
      .expect(200, { accepted: true });
  });
});
