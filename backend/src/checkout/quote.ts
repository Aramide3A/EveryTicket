import {
  calculatePlatformFeeKobo,
  type PlatformFeeRule,
} from './platform-fee.js';

export type CheckoutQuote = {
  ticketSubtotalKobo: number;
  platformFeeKobo: number;
  totalKobo: number;
};

export function calculateCheckoutQuote({
  items,
  platformFeeRule,
  chargePlatformFeeOnFreeOrder = false,
}: {
  items: Array<{ quantity: number; unitPriceKobo: number }>;
  platformFeeRule: PlatformFeeRule;
  chargePlatformFeeOnFreeOrder?: boolean;
}): CheckoutQuote {
  if (items.length === 0) {
    throw new RangeError('at least one ticket item is required');
  }

  const ticketSubtotalKobo = calculateTicketSubtotalKobo(items);
  const platformFeeKobo =
    ticketSubtotalKobo === 0 && !chargePlatformFeeOnFreeOrder
      ? 0
      : calculatePlatformFeeKobo({
          amountKobo: ticketSubtotalKobo,
          rule: platformFeeRule,
        });
  const totalKobo = ticketSubtotalKobo + platformFeeKobo;

  if (!Number.isSafeInteger(totalKobo)) {
    throw new RangeError('checkout total exceeds the supported kobo range');
  }

  return { ticketSubtotalKobo, platformFeeKobo, totalKobo };
}

function calculateTicketSubtotalKobo(
  items: Array<{ quantity: number; unitPriceKobo: number }>,
): number {
  let subtotal = 0n;

  for (const { quantity, unitPriceKobo } of items) {
    assertPositiveSafeInteger(quantity, 'quantity');
    assertNonNegativeSafeInteger(unitPriceKobo, 'unitPriceKobo');
    subtotal += BigInt(quantity) * BigInt(unitPriceKobo);
  }

  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('ticket subtotal exceeds the supported kobo range');
  }

  return Number(subtotal);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}
