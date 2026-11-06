import 'dotenv/config';
import 'reflect-metadata';
import { createApi } from './api.js';
import { startApplication } from './application-startup.js';
import { readRuntimeConfig } from './config/runtime-config.js';
import { createDatabaseClient } from './persistence/prisma-client.js';
import { startWorker } from './worker.js';

const config = readRuntimeConfig(process.env);

void startApplication({
  createApi: () => createApi(),
  startWorker: () => startWorker(process.env),
  port: config.port,
}).then((application) => {
  console.info(JSON.stringify({ level: 'info', message: 'Redis connected; background jobs scheduled' }));
  console.info(JSON.stringify({ level: 'info', message: 'API listening', port: config.port }));
  void logDatabaseStatus(process.env.DATABASE_URL!).catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', message: 'Database connection failed', error: error instanceof Error ? error.message : 'unknown error' }));
  });

  const shutdown = () => {
    void application.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function logDatabaseStatus(databaseUrl: string): Promise<void> {
  const database = createDatabaseClient(databaseUrl);
  try {
    await database.$queryRaw`SELECT 1`;
    console.info(JSON.stringify({ level: 'info', message: 'Database connected' }));
  } finally {
    await database.$disconnect();
  }
}
