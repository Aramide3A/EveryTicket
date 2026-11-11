type WorkerScheduleModule = {
  scheduleRecurringWork(input: {
    queue: { upsertJobScheduler(id: string, repeat: { every: number }, template: { name: string; data: Record<string, never>; opts: { removeOnComplete: number; removeOnFail: number } }): Promise<unknown> };
    paymentReconciliationIntervalMs: number;
    notificationPollIntervalMs: number;
    documentPollIntervalMs: number;
    mediaCleanupIntervalMs: number;
    orderExpiryIntervalMs: number;
  }): Promise<void>;
};

async function loadWorkerSchedule(): Promise<WorkerScheduleModule | undefined> {
  try {
    return await import('../src/worker/worker-schedule.js') as WorkerScheduleModule;
  } catch {
    return undefined;
  }
}

describe('worker recurring schedules', () => {
  it('registers idempotent reconciliation, outbox, and ticket-document jobs', async () => {
    const schedule = await loadWorkerSchedule();
    expect(schedule).toBeDefined();
    if (!schedule) throw new Error('worker scheduling is unavailable');
    const registrations: Array<{ id: string; repeat: { every: number }; template: { name: string; data: Record<string, never>; opts: { removeOnComplete: number; removeOnFail: number } } }> = [];

    await schedule.scheduleRecurringWork({
      queue: { upsertJobScheduler: async (id, repeat, template) => { registrations.push({ id, repeat, template }); } },
      paymentReconciliationIntervalMs: 300_000,
      notificationPollIntervalMs: 60_000,
      documentPollIntervalMs: 60_000,
      mediaCleanupIntervalMs: 3_600_000,
      orderExpiryIntervalMs: 30_000,
    });

    expect(registrations).toEqual([
      { id: 'payment-reconciliation', repeat: { every: 300_000 }, template: { name: 'payment-reconciliation', data: {}, opts: { removeOnComplete: 100, removeOnFail: 1_000 } } },
      { id: 'notification-delivery', repeat: { every: 60_000 }, template: { name: 'notification-delivery', data: {}, opts: { removeOnComplete: 100, removeOnFail: 1_000 } } },
      { id: 'ticket-document-delivery', repeat: { every: 60_000 }, template: { name: 'ticket-document-delivery', data: {}, opts: { removeOnComplete: 100, removeOnFail: 1_000 } } },
      { id: 'expired-media-cleanup', repeat: { every: 3_600_000 }, template: { name: 'expired-media-cleanup', data: {}, opts: { removeOnComplete: 100, removeOnFail: 1_000 } } },
      { id: 'order-expiry', repeat: { every: 30_000 }, template: { name: 'order-expiry', data: {}, opts: { removeOnComplete: 100, removeOnFail: 1_000 } } },
    ]);
  });
});
