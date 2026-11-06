import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { createDatabaseClient } from '../persistence/prisma-client.js';
import { checkReadiness } from './readiness.js';

@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get()
  health(): Promise<{ status: 'ok'; checks: { database: 'ok'; redis: 'ok' } }> {
    return this.ready();
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; checks: { database: 'ok'; redis: 'ok' } }> {
    const databaseUrl = process.env.DATABASE_URL;
    const redisUrl = process.env.REDIS_URL;
    if (!databaseUrl || !redisUrl) throw new ServiceUnavailableException('readiness dependencies are not configured');
    const readiness = await checkReadiness({
      databaseCheck: async () => {
        const database = createDatabaseClient(databaseUrl);
        try {
          await database.$queryRaw`SELECT 1`;
        } finally {
          await database.$disconnect();
        }
      },
      redisCheck: async () => {
        const { Redis } = await import('ioredis');
        const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2_000, lazyConnect: true });
        try {
          await redis.connect();
          await redis.ping();
        } finally {
          redis.disconnect();
        }
      },
    });
    if (readiness.status !== 'ok') throw new ServiceUnavailableException(readiness);
    return { status: 'ok', checks: { database: 'ok', redis: 'ok' } };
  }
}
