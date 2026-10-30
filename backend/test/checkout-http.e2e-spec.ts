import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('checkout HTTP contract', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApi();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires an authenticated customer before accepting checkout input', async () => {
    await request(app.getHttpServer()).post('/orders').send({
      eventId: 'event-id',
      reference: 'order-reference',
      buyer: { name: 'Buyer', email: 'buyer@example.test' },
      items: [{ ticketTypeId: 'ticket-type-id', quantity: 1 }],
    }).expect(401);
  });
});
