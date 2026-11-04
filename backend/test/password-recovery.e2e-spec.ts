import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

describe('password recovery', () => {
  let client: ReturnType<typeof createDatabaseClient> | undefined;
  const email = `${randomUUID()}@example.test`;

  afterAll(async () => {
    if (!client) return;
    await client.$executeRaw`DELETE FROM auth_session WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
    await client.$executeRaw`DELETE FROM auth_account WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
    await client.$executeRaw`DELETE FROM auth_verification WHERE identifier LIKE 'reset-password:%'`;
    await client.$executeRaw`DELETE FROM application_profile WHERE "userId" = (SELECT id FROM auth_user WHERE email = ${email})`;
    await client.$executeRaw`DELETE FROM auth_user WHERE email = ${email}`;
    await client.$disconnect();
  });

  it('delivers a reset token that changes the password exactly once', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('database test configuration is unavailable');
    const { createAuth } = await import('../src/identity/auth.js');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    let delivered: { url: string; token: string } | undefined;
    const auth = (createAuth as unknown as (options: Record<string, unknown>) => ReturnType<typeof createAuth>)({
      databaseUrl,
      databaseClient: client,
      secret: 'password-recovery-test-secret-that-is-long-enough',
      baseUrl: 'http://localhost:3000/api/auth',
      sendResetPassword: async ({ url, token }: { url: string; token: string }) => { delivered = { url, token }; },
    });
    await auth.api.signUpEmail({ body: { name: 'Recovery user', email, password: 'old-password-123' } });

    await auth.api.requestPasswordReset({ body: { email, redirectTo: 'https://app.example.test/reset-password' } });
    expect(delivered).toEqual({ url: expect.any(String), token: expect.any(String) });
    const resetUrl = new URL(delivered?.url ?? '');
    expect(resetUrl.pathname).toContain('/reset-password/');
    expect(resetUrl.searchParams.get('callbackURL')).toBe('https://app.example.test/reset-password');
    const token = delivered?.token;
    if (!token) throw new Error('reset token was not delivered');
    await expect(auth.api.resetPassword({ body: { token, newPassword: 'new-password-456' } })).resolves.toEqual({ status: true });
    await expect(auth.api.resetPassword({ body: { token, newPassword: 'another-password-789' } })).rejects.toThrow();
    await expect(auth.api.signInEmail({ body: { email, password: 'new-password-456' } })).resolves.toMatchObject({ user: { email } });
  });
});
