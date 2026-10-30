type ReadInterval = (value: string | undefined) => number;

async function loadReader(): Promise<ReadInterval | undefined> {
  try {
    return (await import('../src/payments/reconciliation-config.js')).readPaymentReconciliationInterval;
  } catch {
    return undefined;
  }
}

describe('payment reconciliation configuration', () => {
  it('uses a five-minute reconciliation interval by default', async () => {
    const readPaymentReconciliationInterval = await loadReader();

    expect(readPaymentReconciliationInterval).toBeDefined();
    expect(readPaymentReconciliationInterval?.(undefined)).toBe(300_000);
  });

  it.each(['0', '-1', '500.5', 'invalid'])('rejects an unsafe reconciliation interval %s', async (value) => {
    const readPaymentReconciliationInterval = await loadReader();

    expect(() => readPaymentReconciliationInterval?.(value)).toThrow();
  });
});
