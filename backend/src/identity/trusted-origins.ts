const staticTrustedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://everyticket.vercel.app',
  'https://everyticket-admin.vercel.app',
  'https://www.geteveryticket.com',
];

export function trustedOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([environment.PUBLIC_APP_URL, ...staticTrustedOrigins].filter(isOrigin))];
}

function isOrigin(value: string | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.origin === value;
  } catch {
    return false;
  }
}
