export function assertEventCheckoutEligibility({
  startAt,
  now,
}: {
  startAt: Date;
  now: Date;
}): void {
  if (startAt <= now) {
    throw new Error('event sales are unavailable');
  }
}
