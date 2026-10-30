export type RuntimeConfig = {
  port: number;
  publicAppUrl?: string;
};

export function readRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const port = readPort(environment.PORT);
  const publicAppUrl = readPublicAppUrl(environment.PUBLIC_APP_URL);

  return publicAppUrl ? { port, publicAppUrl } : { port };
}

function readPort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function readPublicAppUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_APP_URL must be an HTTPS origin');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('PUBLIC_APP_URL must be an HTTPS origin');
  }

  return url.origin;
}
