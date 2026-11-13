import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createDatabaseClient } from '../persistence/prisma-client.js';
import { createResendEmailSender } from '../worker/resend-email-sender.js';
import { linkGuestOrdersForVerifiedUser } from './guest-order-link.js';
import { trustedOrigins } from './trusted-origins.js';

type AuthOptions = {
  baseUrl: string;
  databaseClient?: PrismaClient;
  databaseUrl: string;
  secret: string;
  trustedOrigins?: string[];
  requireEmailVerification?: boolean;
  sendVerificationEmail?: (input: { user: { email: string }; url: string }) => Promise<void>;
  sendResetPassword?: (input: { user: { email: string }; url: string; token: string }) => Promise<void>;
};

export function createAuth({
  baseUrl,
  databaseClient,
  databaseUrl,
  secret,
  trustedOrigins,
  requireEmailVerification = false,
  sendVerificationEmail,
  sendResetPassword,
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
      enabled: true,
      requireEmailVerification,
      sendResetPassword,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail,
      afterEmailVerification: async (user) => {
        await linkGuestOrdersForVerifiedUser({ database, user });
      },
    },
    user: { modelName: 'auth_user' },
    session: { modelName: 'auth_session' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const profile = await database.applicationProfile.create({
              data: { userId: user.id }
            });
            await linkGuestOrdersForVerifiedUser({ database, user, profileId: profile.id });
          }
        }
      }
    },
    advanced: {
      // The frontend currently uses a different site (`everyticket.vercel.app`)
      // from the API, so its browser requests need an explicitly cross-site,
      // HTTPS-only session cookie.
      useSecureCookies: true,
      defaultCookieAttributes: {
        sameSite: 'none',
        secure: true,
      },
      database: {
        joins: true
      },
      ipAddress: {
        ipAddressHeaders: ['x-real-ip'],
      },
    }
  });
}

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!databaseUrl || !secret) {
  throw new Error('DATABASE_URL and BETTER_AUTH_SECRET must be set');
}

export const authDatabase = createDatabaseClient(databaseUrl);

const emailVerificationEnabled = process.env.NODE_ENV !== 'test';
const verificationEmailSender = emailVerificationEnabled ? createResendEmailSender({
  config: {
    apiKey: requiredEnvironment('RESEND_API_KEY'),
    from: requiredEnvironment('EMAIL_FROM'),
  },
}) : undefined;

export const auth = createAuth({
  databaseUrl,
  databaseClient: authDatabase,
  secret,
  baseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  requireEmailVerification: emailVerificationEnabled,
  sendVerificationEmail: verificationEmailSender ? ({ user, url }) => verificationEmailSender.send({
    to: user.email,
    subject: 'Verify your EverythingTicket email',
    text: `Verify your email address to access your EverythingTicket account: ${url}`,
  }) : undefined,
  sendResetPassword: verificationEmailSender ? ({ user, url }) => verificationEmailSender.send({
    to: user.email,
    subject: 'Reset your EverythingTicket password',
    text: `Reset your EverythingTicket password using this secure link: ${url}`,
  }) : undefined,
  trustedOrigins: trustedOrigins(),
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
