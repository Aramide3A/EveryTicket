export type PlatformFeeRule =
  | { type: 'FIXED'; amountKobo: number }
  | { type: 'PERCENTAGE'; basisPoints: number };

export function calculatePlatformFeeKobo({
  amountKobo,
  rule,
}: {
  amountKobo: number;
  rule: PlatformFeeRule;
}): number {
  assertNonNegativeSafeInteger(amountKobo, 'amountKobo');

  if (rule.type === 'FIXED') {
    assertNonNegativeSafeInteger(rule.amountKobo, 'amountKobo');
    return rule.amountKobo;
  }

  assertNonNegativeSafeInteger(rule.basisPoints, 'basisPoints');
  const roundedFee =
    (BigInt(amountKobo) * BigInt(rule.basisPoints) + 5_000n) / 10_000n;

  if (roundedFee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('calculated fee exceeds the supported kobo range');
  }

  return Number(roundedFee);
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}
