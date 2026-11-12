import { INestApplication } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { createRequestRateLimiter, readRequestRateLimit } from './common/http/request-rate-limit.js';
import { trustedOrigins } from './identity/trusted-origins.js';

export async function createApi(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1');
  const rateLimiter = createRequestRateLimiter();

  // Preserve the legacy application routes while the documented `/api/v1` surface
  // becomes canonical. Authentication and OpenAPI retain their explicit mounts.
  app.use((request: Request, _response: Response, next: NextFunction) => {
    if (!request.url.startsWith('/api/v1/') && !request.url.startsWith('/api/auth') && !request.url.startsWith('/docs')) {
      request.url = `/api/v1${request.url}`;
    }
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const action = sensitiveAction(request);
    if (!action) return next();
    const { limit, windowMs } = readRequestRateLimit(process.env);
    const result = rateLimiter.consume({
      action,
      identity: request.ip || request.socket.remoteAddress || 'unknown',
      limit,
      windowMs,
    });
    if (result.allowed) return next();
    response.setHeader('retry-after', result.retryAfterSeconds.toString());
    response.status(429).json({ statusCode: 429, error: 'Too Many Requests', message: 'request rate limit exceeded' });
  });

  const corsOrigins = new Set(trustedOrigins());
  const allowTrustedOrigin: CustomOrigin = (origin, callback) => {
    callback(null, !origin || corsOrigins.has(origin));
  };
  app.enableCors({
    credentials: true,
    origin: allowTrustedOrigin,
  });

  app.use(helmet());

  if (process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET) {
    const [{ auth }, { toNodeHandler }] = await Promise.all([
      import('./identity/auth.js'),
      import('better-auth/node'),
    ]);
    app.use('/api/auth', toNodeHandler(auth));
  }

  const config = new DocumentBuilder()
    .setTitle('EverythingTicket API')
    .setVersion('0.1.0')
    .addServer('/api/v1', 'Versioned application API')
    .addCookieAuth('better-auth.session_token', { type: 'apiKey', in: 'cookie' }, 'session')
    .addTag('Account', 'Authenticated customer account and ticket access')
    .addTag('Checkout', 'Server-authoritative checkout and order status')
    .addTag('Payments', 'Paystack payment initialization and reconciliation')
    .addTag('Events', 'Public event discovery and organizer event management')
    .addTag('Organizer registration', 'Public organizer account registration and email verification')
    .addTag('Organizer operations', 'Organizer dashboards, attendees, media, refunds, and payouts')
    .addTag('RSVP and admission', 'RSVP guest management and authenticated gate admission')
    .addTag('Administration', 'Administrator controls, platform fees, refunds, and payouts')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  SwaggerModule.setup('api/v1/docs', app, document);

  await app.init();
  return app;
}

export function sensitiveAction(request: Pick<Request, 'method' | 'url'>): string | null {
  if (request.method !== 'POST') return null;
  if (request.url.startsWith('/api/auth/')) return 'authentication';
  if (request.url === '/api/v1/organizer-registration') return 'authentication';
  if (request.url.startsWith('/api/v1/rsvp/')) return 'rsvp-submission';
  if (request.url === '/api/v1/orders' || request.url.startsWith('/api/v1/orders/')) return 'checkout';
  if (request.url.startsWith('/api/v1/payments/')) return 'payment-reconciliation';
  return null;
}
