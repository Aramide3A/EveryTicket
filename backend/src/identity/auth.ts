import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createDatabaseClient } from '../persistence/prisma-client.js';

type AuthOptions = {
  baseUrl: string;
  databaseClient?: PrismaClient;
  databaseUrl: string;
  secret: string;
  trustedOrigins?: string[];
};

export function createAuth({
  baseUrl,
  databaseClient,
  databaseUrl,
  secret,
  trustedOrigins
}: AuthOptions) {
  const database = databaseClient ?? createDatabaseClient(databaseUrl);

  return betterAuth({
    appName: 'EverythingTicket',
    baseURL: baseUrl,
    secret,
    trustedOrigins,
    database: prismaAdapter(database, {
      provider: 'postgresql'
    }),
    emailAndPassword: {
      enabled: true
    },
    user: { modelName: 'auth_user' },
    session: { modelName: 'auth_session' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await database.applicationProfile.create({
              data: { userId: user.id }
            });
          }
        }
      }
    },
    advanced: {
      database: {
        joins: true
      }
    }
  });
}

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!databaseUrl || !secret) {
  throw new Error('DATABASE_URL and BETTER_AUTH_SECRET must be set');
}

export const authDatabase = createDatabaseClient(databaseUrl);

export const auth = createAuth({
  databaseUrl,
  databaseClient: authDatabase,
  secret,
  baseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  trustedOrigins: process.env.PUBLIC_APP_URL
    ? [process.env.PUBLIC_APP_URL]
    : undefined
});
