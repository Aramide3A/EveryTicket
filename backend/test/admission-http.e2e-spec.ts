import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('RSVP and admission HTTP contracts', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApi();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not let an unauthenticated caller create an organizer guest list', async () => {
    await request(app.getHttpServer())
      .get('/organizer/events/known-event/guest-lists')
      .expect(401);
    await request(app.getHttpServer())
      .post('/organizer/events/known-event/guest-lists')
      .send({ name: 'VIP guests' })
      .expect(401);
  });

  it('does not let an unauthenticated caller preview gate credentials', async () => {
    await request(app.getHttpServer())
      .post('/organizer/events/known-event/check-ins/preview')
      .send({ token: 'opaque-token' })
      .expect(401);
  });

  it('does not let an unauthenticated caller revoke a guest credential', async () => {
    await request(app.getHttpServer())
      .post('/organizer/guests/known-guest/revoke')
      .expect(401);
    await request(app.getHttpServer())
      .post('/organizer/guests/known-guest/credential/reissue')
      .expect(401);
  });

  it('does not let an unauthenticated caller manage or export guest data', async () => {
    await request(app.getHttpServer())
      .post('/organizer/guest-lists/known-list/guests')
      .send({ name: 'Guest', email: 'guest@example.test' })
      .expect(401);
    await request(app.getHttpServer())
      .patch('/organizer/guests/known-guest')
      .send({ name: 'Guest', email: 'guest@example.test' })
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/organizer/guest-lists/known-list/guests')
      .send({ guestId: 'known-guest', name: 'Guest', email: 'guest@example.test' })
      .expect(401);
    await request(app.getHttpServer())
      .delete('/organizer/guests/known-guest')
      .expect(401);
    await request(app.getHttpServer())
      .get('/organizer/guest-lists/known-list/guests.csv')
      .expect(401);
  });
});
