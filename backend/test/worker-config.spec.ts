type WorkerConfigModule = {
  readWorkerConfig(environment: NodeJS.ProcessEnv): {
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
};

async function loadWorkerConfig(): Promise<WorkerConfigModule | undefined> {
  try {
    return await import('../src/worker/worker-config.js') as WorkerConfigModule;
  } catch {
    return undefined;
  }
}

const environment: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:password@database.example.test:5432/everythingticket?sslmode=require',
  REDIS_URL: 'rediss://user:password@redis.example.test:6380',
  PAYSTACK_SECRET_KEY: 'sk_test_value',
  ADMISSION_TOKEN_SECRET: 'a-long-ticket-credential-secret',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password',
  EMAIL_FROM: 'EverythingTicket <no-reply@example.test>',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'everythingticket-private',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_PUBLIC_MEDIA_URL: 'https://media.example.test',
};

describe('worker configuration', () => {
  it('requires encrypted external services and returns typed worker settings', async () => {
    const workerConfig = await loadWorkerConfig();
    expect(workerConfig).toBeDefined();
    if (!workerConfig) throw new Error('worker configuration is unavailable');

    expect(workerConfig.readWorkerConfig(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      redisUrl: environment.REDIS_URL,
      paystackSecretKey: environment.PAYSTACK_SECRET_KEY,
      admissionTokenSecret: environment.ADMISSION_TOKEN_SECRET,
      notificationIntervalMs: 60_000,
      documentPollIntervalMs: 60_000,
      mediaCleanupIntervalMs: 3_600_000,
      notificationMaxAttempts: 5,
      smtp: { host: environment.SMTP_HOST, port: 587, user: environment.SMTP_USER, password: environment.SMTP_PASSWORD, from: environment.EMAIL_FROM },
      r2: { endpoint: environment.R2_ENDPOINT, bucket: environment.R2_BUCKET, accessKeyId: environment.R2_ACCESS_KEY_ID, secretAccessKey: environment.R2_SECRET_ACCESS_KEY, publicMediaUrl: environment.R2_PUBLIC_MEDIA_URL },
    });
  });

  it('rejects an unencrypted Redis URL and invalid worker interval', async () => {
    const workerConfig = await loadWorkerConfig();
    expect(workerConfig).toBeDefined();
    if (!workerConfig) throw new Error('worker configuration is unavailable');

    expect(() => workerConfig.readWorkerConfig({ ...environment, REDIS_URL: 'redis://redis.example.test:6379' })).toThrow('REDIS_URL must use rediss');
    expect(() => workerConfig.readWorkerConfig({ ...environment, NOTIFICATION_POLL_INTERVAL_MS: '0' })).toThrow('NOTIFICATION_POLL_INTERVAL_MS');
  });

  it('allows Railway private-network Redis without TLS', async () => {
    const workerConfig = await loadWorkerConfig();
    expect(workerConfig).toBeDefined();
    if (!workerConfig) throw new Error('worker configuration is unavailable');

    const redisUrl = 'redis://default:password@redis.railway.internal:6379';

    expect(workerConfig.readWorkerConfig({ ...environment, REDIS_URL: redisUrl }).redisUrl).toBe(redisUrl);
  });
});
