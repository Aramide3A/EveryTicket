import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function createDatabaseClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl })
  });
}
