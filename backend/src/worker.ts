import { Queue, Worker } from 'bullmq';
import { createDatabaseClient } from './persistence/prisma-client.js';
import { reconcilePendingPayments } from './payments/payment-lifecycle.js';
import { createPaystackGateway } from './payments/paystack-gateway.js';
import { readPaymentReconciliationInterval } from './payments/reconciliation-config.js';
import { removeExpiredMediaUploads } from './media/event-media-operations.js';
import { deliverPendingNotifications } from './worker/notification-delivery.js';
import { createR2ObjectStore } from './worker/r2-object-store.js';
import { createResendEmailSender } from './worker/resend-email-sender.js';
import { processPendingTicketDocuments } from './worker/ticket-document-delivery.js';
import { readWorkerConfig } from './worker/worker-config.js';
import { executeWorkerJob } from './worker/worker-dispatch.js';
import { scheduleRecurringWork } from './worker/worker-schedule.js';

export async function startWorker(environment: NodeJS.ProcessEnv): Promise<{ close(): Promise<void> }> {
  const config = readWorkerConfig(environment);
  async function withDatabase<T>(callback: (database: ReturnType<typeof createDatabaseClient>) => Promise<T>): Promise<T> {
    const database = createDatabaseClient(config.databaseUrl);
    try {
      return await callback(database);
    } finally {
      await database.$disconnect();
    }
  }
  const connection = { url: config.redisUrl, maxRetriesPerRequest: null };
  const queue = new Queue('everythingticket-worker', { connection });
  const gateway = createPaystackGateway({ secretKey: config.paystackSecretKey });
  const sender = createResendEmailSender({ config: config.resend });
  const objectStore = createR2ObjectStore({ config: config.r2 });

  const worker = new Worker('everythingticket-worker', async (job) => executeWorkerJob({
    name: job.name,
    handlers: {
      reconcilePayments: async () => withDatabase((database) => reconcilePendingPayments({ database, gateway, now: new Date() }).then(() => undefined)),
      deliverNotifications: async () => withDatabase((database) => deliverPendingNotifications({ database, sender, now: new Date(), maxAttempts: config.notificationMaxAttempts }).then(() => undefined)),
      generateTicketDocuments: async () => withDatabase((database) => processPendingTicketDocuments({ database, objectStore, ticketCredentialSecret: config.admissionTokenSecret, now: new Date() }).then(() => undefined)),
      removeExpiredMedia: async () => withDatabase((database) => removeExpiredMediaUploads({ database, deleteObject: (objectKey) => objectStore.deletePublicObject({ objectKey }), now: new Date() }).then(() => undefined)),
    },
  }), { connection });

  worker.on('failed', (job, error) => {
    console.error(JSON.stringify({ level: 'error', message: 'worker job failed', jobName: job?.name, jobId: job?.id, error: error.message }));
  });

  try {
    await scheduleRecurringWork({
      queue,
      paymentReconciliationIntervalMs: readPaymentReconciliationInterval(environment.PAYMENT_RECONCILIATION_INTERVAL_MS),
      notificationPollIntervalMs: config.notificationIntervalMs,
      documentPollIntervalMs: config.documentPollIntervalMs,
      mediaCleanupIntervalMs: config.mediaCleanupIntervalMs,
    });
  } catch (error) {
    await Promise.allSettled([worker.close(), queue.close()]);
    throw error;
  }

  return { close: async () => { await Promise.all([worker.close(), queue.close()]); } };
}
