import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('organizer operations HTTP contracts', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApi();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not expose organizer operations without an active organizer session', async () => {
    const server = app.getHttpServer();
    await request(server).get('/organizer/events/known-event/dashboard').expect(401);
    await request(server).get('/organizer/events/known-event/orders').expect(401);
    await request(server).get('/organizer/events/known-event/attendees').expect(401);
    await request(server).get('/organizer/events/known-event/attendees.csv').expect(401);
    await request(server).post('/api/v1/organizer/events/known-event/media/complete').send({ mediaId: 'known-media' }).expect(401);
    await request(server).post('/organizer/orders/known-order/refund-requests').send({ ticketIds: ['ticket'], ticketRefundKobo: 100, platformFeeRefundKobo: 0, reason: 'Reason' }).expect(401);
    await request(server).patch('/organizer/refund-requests/known-refund').send({ ticketRefundKobo: 100, platformFeeRefundKobo: 0, reason: 'Reason' }).expect(401);
    await request(server).post('/organizer/refund-requests/known-refund/cancel').expect(401);
    await request(server).get('/organizer/refund-requests').expect(401);
    await request(server).post('/organizer/events/known-event/payout-requests').expect(401);
    await request(server).get('/organizer/payout-requests').expect(401);
  });
});
