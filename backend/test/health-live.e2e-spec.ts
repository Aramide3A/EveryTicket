import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

type ApiOptions = { publicAppUrl?: string };

async function startApi(
  options?: ApiOptions
): Promise<INestApplication | undefined> {
  try {
    const modulePath = '../src/api.js';
    const { createApi } = (await import(modulePath)) as {
      createApi: (options?: ApiOptions) => Promise<INestApplication>;
    };
    return createApi(options);
  } catch (error) {
    if (String(error).includes("Cannot find module '../src/api.js'")) {
      return undefined;
    }

    throw error;
  }
}

describe('GET /health/live', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports that the API process is live', async () => {
    app = await startApi();

    const response = app
      ? await request(app.getHttpServer()).get('/health/live')
      : { body: undefined, status: 0 };

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('exposes the versioned API contract', async () => {
    app = await startApi();

    if (!app) {
      throw new Error('API factory is unavailable');
    }

    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200, { status: 'ok' });
  });

  it('assigns a distinct request ID to each response', async () => {
    app = await startApi();

    if (!app) {
      throw new Error('API factory is unavailable');
    }

    const api = app.getHttpServer();
    const first = await request(api).get('/health/live');
    const second = await request(api).get('/health/live');

    expect(first.headers['x-request-id']).toEqual(expect.any(String));
    expect(second.headers['x-request-id']).toEqual(expect.any(String));
    expect(second.headers['x-request-id']).not.toEqual(first.headers['x-request-id']);
  });

  it('sets baseline security headers', async () => {
    app = await startApi();

    if (!app) {
      throw new Error('API factory is unavailable');
    }

    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('permits credentialed calls from the configured web origin', async () => {
    app = await startApi({
      publicAppUrl: 'https://app.everythingticket.example'
    });

    if (!app) {
      throw new Error('API factory is unavailable');
    }

    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'https://app.everythingticket.example');

    expect(response.headers['access-control-allow-origin']).toBe(
      'https://app.everythingticket.example'
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('publishes an OpenAPI document for API consumers', async () => {
    app = await startApi();

    if (!app) {
      throw new Error('API factory is unavailable');
    }

    const response = await request(app.getHttpServer()).get('/docs-json');

    expect(response.status).toBe(200);
    expect(response.body.info).toEqual(
      expect.objectContaining({
        title: 'EverythingTicket API',
        version: '0.1.0'
      })
    );
    expect(response.body.paths).toEqual(
      expect.objectContaining({
        '/api/v1/health/live': expect.any(Object),
        '/api/v1/orders/quote': expect.any(Object),
        '/api/v1/account/me': expect.any(Object),
      }),
    );
    expect(response.body.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Account' }),
        expect.objectContaining({ name: 'Checkout' }),
        expect.objectContaining({ name: 'Payments' }),
        expect.objectContaining({ name: 'Events' }),
        expect.objectContaining({ name: 'Organizer operations' }),
        expect.objectContaining({ name: 'RSVP and admission' }),
        expect.objectContaining({ name: 'Administration' }),
      ]),
    );

    await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
  });

  it('documents every implementation-guide workflow endpoint', async () => {
    app = await startApi();
    if (!app) throw new Error('API factory is unavailable');

    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const paths = response.body.paths as Record<string, unknown>;
    const requiredPaths = [
      '/api/v1/account/me',
      '/api/v1/account/orders',
      '/api/v1/account/orders/{orderReference}',
      '/api/v1/account/tickets',
      '/api/v1/account/tickets/{ticketId}',
      '/api/v1/account/tickets/{ticketId}/download',
      '/api/v1/categories',
      '/api/v1/events',
      '/api/v1/events/{slug}',
      '/api/v1/orders/quote',
      '/api/v1/orders',
      '/api/v1/orders/{orderReference}/status',
      '/api/v1/orders/{orderReference}/reconcile',
      '/api/v1/webhooks/paystack',
      '/api/v1/organizer/events',
      '/api/v1/organizer-registration',
      '/api/v1/organizer/events/{eventId}',
      '/api/v1/organizer/events/{eventId}/publish',
      '/api/v1/organizer/events/{eventId}/unpublish',
      '/api/v1/organizer/events/{eventId}/ticket-types',
      '/api/v1/organizer/events/{eventId}/ticket-types/{ticketTypeId}',
      '/api/v1/organizer/events/{eventId}/dashboard',
      '/api/v1/organizer/events/{eventId}/orders',
      '/api/v1/organizer/events/{eventId}/attendees',
      '/api/v1/organizer/events/{eventId}/attendees.csv',
      '/api/v1/organizer/events/{eventId}/media/upload-intent',
      '/api/v1/organizer/events/{eventId}/media/complete',
      '/api/v1/organizer/orders/{orderId}/refund-requests',
      '/api/v1/organizer/refund-requests',
      '/api/v1/organizer/events/{eventId}/payout-requests',
      '/api/v1/organizer/payout-requests',
      '/api/v1/organizer/events/{eventId}/guest-lists',
      '/api/v1/organizer/guest-lists/{guestListId}/links',
      '/api/v1/organizer/guest-lists/{guestListId}/guests',
      '/api/v1/organizer/guest-lists/{guestListId}/guests.csv',
      '/api/v1/rsvp/{token}',
      '/api/v1/rsvp/{token}/responses',
      '/api/v1/organizer/events/{eventId}/check-ins/preview',
      '/api/v1/organizer/events/{eventId}/check-ins/confirm',
      '/api/v1/organizer/events/{eventId}/check-ins/summary',
      '/api/v1/admin/events',
      '/api/v1/admin/events/{eventId}/suspend',
      '/api/v1/admin/events/{eventId}/restore',
      '/api/v1/admin/events/{eventId}/featured',
      '/api/v1/admin/users',
      '/api/v1/admin/users/{profileId}/block',
      '/api/v1/admin/users/{profileId}/unblock',
      '/api/v1/admin/orders',
      '/api/v1/admin/refund-requests',
      '/api/v1/admin/refund-requests/{refundRequestId}/approve',
      '/api/v1/admin/refund-requests/{refundRequestId}/reject',
      '/api/v1/admin/refund-requests/{refundRequestId}/execute',
      '/api/v1/admin/refund-requests/{refundRequestId}/reconcile',
      '/api/v1/admin/refund-requests/{refundRequestId}/mark-processed',
      '/api/v1/admin/payout-requests',
      '/api/v1/admin/payout-requests/{payoutRequestId}/approve',
      '/api/v1/admin/payout-requests/{payoutRequestId}/reject',
      '/api/v1/admin/payout-requests/{payoutRequestId}/mark-paid',
      '/api/v1/admin/platform-fee-rule',
      '/api/v1/admin/summary',
    ];

    for (const path of requiredPaths) expect(paths[path]).toBeDefined();

    const requiredOperations: Array<[string, string]> = [
      ['/api/v1/account/me', 'get'],
      ['/api/v1/account/orders', 'get'],
      ['/api/v1/account/orders/{orderReference}', 'get'],
      ['/api/v1/account/tickets', 'get'],
      ['/api/v1/account/tickets/{ticketId}', 'get'],
      ['/api/v1/account/tickets/{ticketId}/download', 'get'],
      ['/api/v1/categories', 'get'],
      ['/api/v1/events', 'get'],
      ['/api/v1/events/{slug}', 'get'],
      ['/api/v1/orders/quote', 'post'],
      ['/api/v1/orders', 'post'],
      ['/api/v1/orders/{orderReference}/status', 'get'],
      ['/api/v1/orders/{orderReference}/reconcile', 'post'],
      ['/api/v1/webhooks/paystack', 'post'],
      ['/api/v1/organizer/events', 'get'],
      ['/api/v1/organizer-registration', 'post'],
      ['/api/v1/organizer/events', 'post'],
      ['/api/v1/organizer/events/{eventId}', 'get'],
      ['/api/v1/organizer/events/{eventId}', 'patch'],
      ['/api/v1/organizer/events/{eventId}/publish', 'post'],
      ['/api/v1/organizer/events/{eventId}/unpublish', 'post'],
      ['/api/v1/organizer/events/{eventId}/ticket-types', 'post'],
      ['/api/v1/organizer/events/{eventId}/ticket-types/{ticketTypeId}', 'patch'],
      ['/api/v1/organizer/events/{eventId}/ticket-types/{ticketTypeId}', 'delete'],
      ['/api/v1/organizer/events/{eventId}/dashboard', 'get'],
      ['/api/v1/organizer/events/{eventId}/orders', 'get'],
      ['/api/v1/organizer/events/{eventId}/attendees', 'get'],
      ['/api/v1/organizer/events/{eventId}/attendees.csv', 'get'],
      ['/api/v1/organizer/events/{eventId}/media/upload-intent', 'post'],
      ['/api/v1/organizer/events/{eventId}/media/complete', 'post'],
      ['/api/v1/organizer/orders/{orderId}/refund-requests', 'post'],
      ['/api/v1/organizer/refund-requests', 'get'],
      ['/api/v1/organizer/events/{eventId}/payout-requests', 'post'],
      ['/api/v1/organizer/payout-requests', 'get'],
      ['/api/v1/organizer/events/{eventId}/guest-lists', 'post'],
      ['/api/v1/organizer/guest-lists/{guestListId}/links', 'post'],
      ['/api/v1/organizer/guest-lists/{guestListId}/guests', 'get'],
      ['/api/v1/organizer/guest-lists/{guestListId}/guests', 'post'],
      ['/api/v1/organizer/guest-lists/{guestListId}/guests', 'patch'],
      ['/api/v1/organizer/guest-lists/{guestListId}/guests.csv', 'get'],
      ['/api/v1/rsvp/{token}', 'get'],
      ['/api/v1/rsvp/{token}/responses', 'post'],
      ['/api/v1/organizer/events/{eventId}/check-ins/preview', 'post'],
      ['/api/v1/organizer/events/{eventId}/check-ins/confirm', 'post'],
      ['/api/v1/organizer/events/{eventId}/check-ins/summary', 'get'],
      ['/api/v1/admin/events', 'get'],
      ['/api/v1/admin/events/{eventId}/suspend', 'post'],
      ['/api/v1/admin/events/{eventId}/restore', 'post'],
      ['/api/v1/admin/events/{eventId}/featured', 'patch'],
      ['/api/v1/admin/users', 'get'],
      ['/api/v1/admin/users/{profileId}/block', 'post'],
      ['/api/v1/admin/users/{profileId}/unblock', 'post'],
      ['/api/v1/admin/orders', 'get'],
      ['/api/v1/admin/refund-requests', 'get'],
      ['/api/v1/admin/refund-requests/{refundRequestId}/approve', 'post'],
      ['/api/v1/admin/refund-requests/{refundRequestId}/reject', 'post'],
      ['/api/v1/admin/refund-requests/{refundRequestId}/execute', 'post'],
      ['/api/v1/admin/refund-requests/{refundRequestId}/reconcile', 'post'],
      ['/api/v1/admin/refund-requests/{refundRequestId}/mark-processed', 'post'],
      ['/api/v1/admin/payout-requests', 'get'],
      ['/api/v1/admin/payout-requests/{payoutRequestId}/approve', 'post'],
      ['/api/v1/admin/payout-requests/{payoutRequestId}/reject', 'post'],
      ['/api/v1/admin/payout-requests/{payoutRequestId}/mark-paid', 'post'],
      ['/api/v1/admin/platform-fee-rule', 'get'],
      ['/api/v1/admin/platform-fee-rule', 'put'],
      ['/api/v1/admin/summary', 'get'],
    ];

    for (const [path, method] of requiredOperations) {
      expect((paths[path] as Record<string, unknown>)[method]).toBeDefined();
    }

    for (const [path, method] of [
      ['/api/v1/admin/summary', 'get'],
      ['/api/v1/organizer/events/{eventId}/dashboard', 'get'],
      ['/api/v1/organizer/guest-lists/{guestListId}/guests', 'post'],
      ['/api/v1/organizer/events/{eventId}/check-ins/confirm', 'post'],
      ['/api/v1/organizer/events/{eventId}/ticket-types', 'post'],
    ]) {
      expect((paths[path] as Record<string, { security?: unknown }>)[method].security).toEqual([{ session: [] }]);
    }
    expect((paths['/api/v1/rsvp/{token}'] as Record<string, { security?: unknown }>).get.security).toBeUndefined();
    expect((paths['/api/v1/rsvp/{token}/responses'] as Record<string, { security?: unknown }>).post.security).toBeUndefined();
  });
});

describe('readiness checks', () => {
  it('reports ready only when both durable database and queue Redis dependencies respond', async () => {
    const readiness = await import('../src/health/readiness.js');

    await expect(readiness.checkReadiness({ databaseCheck: async () => undefined, redisCheck: async () => undefined })).resolves.toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
    await expect(readiness.checkReadiness({ databaseCheck: async () => undefined, redisCheck: async () => { throw new Error('unavailable'); } })).resolves.toEqual({ status: 'error', checks: { database: 'ok', redis: 'error' } });
  });
});
