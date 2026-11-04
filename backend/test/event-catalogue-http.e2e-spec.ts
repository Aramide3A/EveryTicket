import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('event catalogue HTTP contract', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApi();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes public event discovery without a session', async () => {
    await request(app.getHttpServer()).get('/events').expect(200);
  });

  it('does not allow an unauthenticated caller to create an organizer event', async () => {
    await request(app.getHttpServer()).post('/organizer/events').send({}).expect(401);
  });

  it('protects the full organizer event and ticket-type lifecycle', async () => {
    const server = app.getHttpServer();
    await request(server).get('/organizer/events').expect(401);
    await request(server).get('/organizer/events/known-event').expect(401);
    await request(server).patch('/organizer/events/known-event').send({ title: 'Updated' }).expect(401);
    await request(server).post('/organizer/events/known-event/unpublish').expect(401);
    await request(server).post('/organizer/events/known-event/cancel').send({ reason: 'Cancelled' }).expect(401);
    await request(server).delete('/organizer/events/known-event').expect(401);
    await request(server).post('/organizer/events/known-event/ticket-types').send({}).expect(401);
    await request(server).patch('/organizer/events/known-event/ticket-types/known-ticket-type').send({}).expect(401);
    await request(server).delete('/organizer/events/known-event/ticket-types/known-ticket-type').expect(401);
  });
});
