const DEFAULT_RECONCILIATION_INTERVAL_MS = 300_000;

export function readPaymentReconciliationInterval(value: string | undefined): number {
  if (!value) {
    return DEFAULT_RECONCILIATION_INTERVAL_MS;
  }
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 1_000) {
    throw new Error('PAYMENT_RECONCILIATION_INTERVAL_MS must be an integer of at least 1000');
  }
  return interval;
}
