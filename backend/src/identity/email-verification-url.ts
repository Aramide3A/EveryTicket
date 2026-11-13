export function withFrontendVerificationCallback(url: string, publicAppUrl: string): string {
  const verificationUrl = new URL(url);
  const callbackUrl = verificationUrl.searchParams.get('callbackURL');
  if (!callbackUrl || callbackUrl === '/') {
    verificationUrl.searchParams.set('callbackURL', new URL(publicAppUrl).origin);
  }
  return verificationUrl.toString();
}
