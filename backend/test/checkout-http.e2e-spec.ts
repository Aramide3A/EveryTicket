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

  it('accepts guest checkout input without an authenticated customer session', async () => {
    await request(app.getHttpServer()).post('/orders').send({
      eventId: 'event-id',
      reference: 'order-reference',
      buyer: { name: 'Buyer', email: 'buyer@example.test' },
      items: [{ ticketTypeId: 'ticket-type-id', quantity: 1 }],
    }).expect((response) => expect(response.status).not.toBe(401));
  });
});
