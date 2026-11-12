import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';

describe('CORS', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApi();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['http://localhost:5173', 'https://everyticket-admin.vercel.app', 'https://www.geteveryticket.com'])('permits credentialed calls and preflight from %s', async (origin) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', origin)
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    const preflight = await request(app.getHttpServer())
      .options('/api/v1/orders/quote')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant credentialed browser access to an untrusted origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'https://untrusted-client.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
