describe('Better Auth trusted origins', () => {
  it('trusts the local and Vercel frontends alongside the configured app', async () => {
    const previous = {
      databaseUrl: process.env.DATABASE_URL,
      secret: process.env.BETTER_AUTH_SECRET,
      appUrl: process.env.PUBLIC_APP_URL,
      nodeEnv: process.env.NODE_ENV,
    };
    process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
    process.env.BETTER_AUTH_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.PUBLIC_APP_URL = 'https://app.everythingticket.example';
    process.env.NODE_ENV = 'test';

    try {
      const { auth } = await import('../src/identity/auth.js');
      expect(auth.options.trustedOrigins).toEqual(expect.arrayContaining([
        'https://app.everythingticket.example',
        'http://localhost:5173',
        'https://everyticket.vercel.app',
        'https://everyticket-admin.vercel.app',
        'https://www.geteveryticket.com',
      ]));
      expect(auth.options.advanced?.useSecureCookies).toBe(true);
      expect(auth.options.advanced?.defaultCookieAttributes).toEqual(expect.objectContaining({
        sameSite: 'none',
        secure: true,
      }));
    } finally {
      if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.databaseUrl;
      if (previous.secret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previous.secret;
      if (previous.appUrl === undefined) delete process.env.PUBLIC_APP_URL;
      else process.env.PUBLIC_APP_URL = previous.appUrl;
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
    }
  });
});
