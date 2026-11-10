const PERCENTAGE_BASIS_POINTS = 150;
const FLAT_FEE_KOBO = 10_000;
const FLAT_FEE_WAIVER_THRESHOLD_KOBO = 250_000;
const FEE_CAP_KOBO = 200_000;

export function calculatePaystackCustomerChargeKobo(amountKobo: number): {
  paystackFeeKobo: number;
  paystackChargeKobo: number;
} {
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) {
    throw new RangeError('Paystack amount must be a non-negative safe integer');
  }
  if (amountKobo === 0) return { paystackFeeKobo: 0, paystackChargeKobo: 0 };

  let low = amountKobo;
  let high = amountKobo + FEE_CAP_KOBO + FLAT_FEE_KOBO + Math.ceil((amountKobo * PERCENTAGE_BASIS_POINTS) / 10_000) + 1;
  while (netAmountKobo(high) < amountKobo) high *= 2;
  while (low < high) {
    const candidate = Math.floor((low + high) / 2);
    if (netAmountKobo(candidate) >= amountKobo) high = candidate;
    else low = candidate + 1;
  }
  return { paystackFeeKobo: paystackFeeKobo(low), paystackChargeKobo: low };
}

function netAmountKobo(grossAmountKobo: number): number {
  return grossAmountKobo - paystackFeeKobo(grossAmountKobo);
}

function paystackFeeKobo(grossAmountKobo: number): number {
  const percentageFee = Math.ceil((grossAmountKobo * PERCENTAGE_BASIS_POINTS) / 10_000);
  const flatFee = grossAmountKobo < FLAT_FEE_WAIVER_THRESHOLD_KOBO ? 0 : FLAT_FEE_KOBO;
  return Math.min(percentageFee + flatFee, FEE_CAP_KOBO);
}
