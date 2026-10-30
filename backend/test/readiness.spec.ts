type ReadinessModule = {
  checkReadiness(input: { databaseCheck(): Promise<void>; redisCheck(): Promise<void> }): Promise<{ status: 'ok' | 'error'; checks: { database: 'ok' | 'error'; redis: 'ok' | 'error' } }>;
};

async function loadReadiness(): Promise<ReadinessModule | undefined> {
  try {
    return await import('../src/health/readiness.js') as ReadinessModule;
  } catch {
    return undefined;
  }
}

describe('readiness checks', () => {
  it('reports ready only when both durable database and queue Redis dependencies respond', async () => {
    const readiness = await loadReadiness();
    expect(readiness).toBeDefined();
    if (!readiness) throw new Error('readiness check is unavailable');

    await expect(readiness.checkReadiness({ databaseCheck: async () => undefined, redisCheck: async () => undefined })).resolves.toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
    await expect(readiness.checkReadiness({ databaseCheck: async () => undefined, redisCheck: async () => { throw new Error('unavailable'); } })).resolves.toEqual({ status: 'error', checks: { database: 'ok', redis: 'error' } });
  });
});
