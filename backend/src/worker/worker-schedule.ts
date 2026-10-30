type SchedulerQueue = {
  upsertJobScheduler(id: string, repeat: { every: number }, template: { name: string; data: Record<string, never>; opts: { removeOnComplete: number; removeOnFail: number } }): Promise<unknown>;
};

export async function scheduleRecurringWork({
  queue,
  paymentReconciliationIntervalMs,
  notificationPollIntervalMs,
  documentPollIntervalMs,
  mediaCleanupIntervalMs,
}: {
  queue: SchedulerQueue;
  paymentReconciliationIntervalMs: number;
  notificationPollIntervalMs: number;
  documentPollIntervalMs: number;
  mediaCleanupIntervalMs: number;
}): Promise<void> {
  const options = { removeOnComplete: 100, removeOnFail: 1_000 };
  await queue.upsertJobScheduler('payment-reconciliation', { every: paymentReconciliationIntervalMs }, { name: 'payment-reconciliation', data: {}, opts: options });
  await queue.upsertJobScheduler('notification-delivery', { every: notificationPollIntervalMs }, { name: 'notification-delivery', data: {}, opts: options });
  await queue.upsertJobScheduler('ticket-document-delivery', { every: documentPollIntervalMs }, { name: 'ticket-document-delivery', data: {}, opts: options });
  await queue.upsertJobScheduler('expired-media-cleanup', { every: mediaCleanupIntervalMs }, { name: 'expired-media-cleanup', data: {}, opts: options });
}
