type WorkerDispatchModule = {
  executeWorkerJob(input: {
    name: string;
    handlers: {
      reconcilePayments(): Promise<void>;
      deliverNotifications(): Promise<void>;
      generateTicketDocuments(): Promise<void>;
      removeExpiredMedia(): Promise<void>;
    };
  }): Promise<void>;
};

async function loadWorkerDispatch(): Promise<WorkerDispatchModule | undefined> {
  try {
    return await import('../src/worker/worker-dispatch.js') as WorkerDispatchModule;
  } catch {
    return undefined;
  }
}

describe('worker job dispatch', () => {
  it('runs only the requested durable work handler and rejects unknown jobs', async () => {
    const dispatch = await loadWorkerDispatch();
    expect(dispatch).toBeDefined();
    if (!dispatch) throw new Error('worker dispatch is unavailable');
    const calls: string[] = [];
    const handlers = {
      reconcilePayments: async () => { calls.push('payments'); },
      deliverNotifications: async () => { calls.push('notifications'); },
      generateTicketDocuments: async () => { calls.push('documents'); },
      removeExpiredMedia: async () => { calls.push('media'); },
    };

    await dispatch.executeWorkerJob({ name: 'ticket-document-delivery', handlers });
    expect(calls).toEqual(['documents']);
    await dispatch.executeWorkerJob({ name: 'expired-media-cleanup', handlers });
    expect(calls).toEqual(['documents', 'media']);
    await expect(dispatch.executeWorkerJob({ name: 'unknown', handlers })).rejects.toThrow('unknown worker job');
  });
});
