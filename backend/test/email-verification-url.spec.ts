type EmailVerificationUrlModule = {
  withFrontendVerificationCallback(url: string, publicAppUrl: string): string;
};

async function loadEmailVerificationUrl(): Promise<EmailVerificationUrlModule | undefined> {
  try {
    return await import('../src/identity/email-verification-url.js') as EmailVerificationUrlModule;
  } catch {
    return undefined;
  }
}

describe('email verification URL', () => {
  it('redirects a verified user from the API callback to the public frontend', async () => {
    const verificationUrl = await loadEmailVerificationUrl();
    expect(verificationUrl).toBeDefined();
    if (!verificationUrl) throw new Error('email verification URL helper is unavailable');

    const url = verificationUrl.withFrontendVerificationCallback(
      'https://api.example.test/api/auth/verify-email?token=token-123&callbackURL=%2F',
      'https://app.example.test',
    );

    expect(new URL(url).searchParams.get('callbackURL')).toBe('https://app.example.test');
  });
});
