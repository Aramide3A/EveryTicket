export type WorkerConfig = {
  databaseUrl: string;
  redisUrl: string;
  paystackSecretKey: string;
  admissionTokenSecret: string;
  notificationIntervalMs: number;
  documentPollIntervalMs: number;
  mediaCleanupIntervalMs: number;
  notificationMaxAttempts: number;
  smtp: { host: string; port: number; user: string; password: string; from: string };
  r2: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicMediaUrl: string };
};

export function readWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const redisUrl = required(environment, 'REDIS_URL');
  validateRedisUrl(redisUrl);
  return {
    databaseUrl: required(environment, 'DATABASE_URL'),
    redisUrl,
    paystackSecretKey: required(environment, 'PAYSTACK_SECRET_KEY'),
    admissionTokenSecret: required(environment, 'ADMISSION_TOKEN_SECRET'),
    notificationIntervalMs: positiveInteger(environment.NOTIFICATION_POLL_INTERVAL_MS, 'NOTIFICATION_POLL_INTERVAL_MS', 60_000),
    documentPollIntervalMs: positiveInteger(environment.DOCUMENT_POLL_INTERVAL_MS, 'DOCUMENT_POLL_INTERVAL_MS', 60_000),
    mediaCleanupIntervalMs: positiveInteger(environment.MEDIA_CLEANUP_INTERVAL_MS, 'MEDIA_CLEANUP_INTERVAL_MS', 3_600_000),
    notificationMaxAttempts: positiveInteger(environment.NOTIFICATION_MAX_ATTEMPTS, 'NOTIFICATION_MAX_ATTEMPTS', 5),
    smtp: {
      host: required(environment, 'SMTP_HOST'),
      port: positiveInteger(environment.SMTP_PORT, 'SMTP_PORT', 587),
      user: required(environment, 'SMTP_USER'),
      password: required(environment, 'SMTP_PASSWORD'),
      from: required(environment, 'EMAIL_FROM'),
    },
    r2: readR2Config(environment),
  };
}

function validateRedisUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REDIS_URL must be a Redis URL');
  }

  if (url.protocol === 'rediss:') return;
  if (url.protocol === 'redis:' && (url.hostname === 'railway.internal' || url.hostname.endsWith('.railway.internal'))) return;
  throw new Error('REDIS_URL must use rediss for encrypted external Redis');
}

export function readR2Config(environment: NodeJS.ProcessEnv): WorkerConfig['r2'] {
  return {
    endpoint: httpsUrl(required(environment, 'R2_ENDPOINT'), 'R2_ENDPOINT'),
    bucket: required(environment, 'R2_BUCKET'),
    accessKeyId: required(environment, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(environment, 'R2_SECRET_ACCESS_KEY'),
    publicMediaUrl: httpsUrl(required(environment, 'R2_PUBLIC_MEDIA_URL'), 'R2_PUBLIC_MEDIA_URL'),
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
  return result;
}

function httpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be an HTTPS URL`);
  return url.toString().replace(/\/$/, '');
}
