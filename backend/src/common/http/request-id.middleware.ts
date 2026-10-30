import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { writeRequestLog } from './structured-log.js';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = Date.now();
    response.setHeader('x-request-id', requestId);
    if (process.env.LOG_HTTP_REQUESTS === 'true') {
      response.once('finish', () => writeRequestLog({
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        requestId,
        durationMs: Date.now() - startedAt,
      }));
    }
    next();
  }
}
