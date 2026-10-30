type CheckoutQuoteCalculator = (input: {
  items: Array<{ quantity: number; unitPriceKobo: number }>;
  platformFeeRule:
    | { type: 'FIXED'; amountKobo: number }
    | { type: 'PERCENTAGE'; basisPoints: number };
  chargePlatformFeeOnFreeOrder?: boolean;
}) => {
  ticketSubtotalKobo: number;
  platformFeeKobo: number;
  totalKobo: number;
};

async function loadQuoteCalculator(): Promise<CheckoutQuoteCalculator | undefined> {
  try {
    const module = await import('../src/checkout/quote.js');
    return module.calculateCheckoutQuote;
  } catch {
    return undefined;
  }
}

describe('calculateCheckoutQuote', () => {
  it('computes the immutable customer-facing price breakdown from server prices', async () => {
    const calculateCheckoutQuote = await loadQuoteCalculator();

    expect(calculateCheckoutQuote).toBeDefined();
    expect(
      calculateCheckoutQuote?.({
        items: [
          { quantity: 2, unitPriceKobo: 1_250 },
          { quantity: 1, unitPriceKobo: 800 },
        ],
        platformFeeRule: { type: 'PERCENTAGE', basisPoints: 250 },
      }),
    ).toEqual({
      ticketSubtotalKobo: 3_300,
      platformFeeKobo: 83,
      totalKobo: 3_383,
    });
  });

  it('applies a fixed platform fee once per order', async () => {
    const calculateCheckoutQuote = await loadQuoteCalculator();

    expect(calculateCheckoutQuote).toBeDefined();
    expect(
      calculateCheckoutQuote?.({
        items: [
          { quantity: 2, unitPriceKobo: 1_250 },
          { quantity: 1, unitPriceKobo: 800 },
        ],
        platformFeeRule: { type: 'FIXED', amountKobo: 500 },
      }),
    ).toEqual({
      ticketSubtotalKobo: 3_300,
      platformFeeKobo: 500,
      totalKobo: 3_800,
    });
  });

  it('does not add a fee to a free order unless explicitly enabled', async () => {
    const calculateCheckoutQuote = await loadQuoteCalculator();

    expect(calculateCheckoutQuote).toBeDefined();
    expect(
      calculateCheckoutQuote?.({
        items: [{ quantity: 1, unitPriceKobo: 0 }],
        platformFeeRule: { type: 'FIXED', amountKobo: 500 },
      }),
    ).toEqual({
      ticketSubtotalKobo: 0,
      platformFeeKobo: 0,
      totalKobo: 0,
    });
    expect(
      calculateCheckoutQuote?.({
        items: [{ quantity: 1, unitPriceKobo: 0 }],
        platformFeeRule: { type: 'FIXED', amountKobo: 500 },
        chargePlatformFeeOnFreeOrder: true,
      }),
    ).toEqual({
      ticketSubtotalKobo: 0,
      platformFeeKobo: 500,
      totalKobo: 500,
    });
  });

  it.each([
    { items: [] },
    { items: [{ quantity: 0, unitPriceKobo: 100 }] },
    { items: [{ quantity: 1.5, unitPriceKobo: 100 }] },
    { items: [{ quantity: 1, unitPriceKobo: -1 }] },
  ])('rejects invalid order items: %o', async ({ items }) => {
    const calculateCheckoutQuote = await loadQuoteCalculator();

    expect(calculateCheckoutQuote).toBeDefined();
    expect(() =>
      calculateCheckoutQuote?.({
        items,
        platformFeeRule: { type: 'FIXED', amountKobo: 0 },
      }),
    ).toThrow();
  });
});

describe('event checkout eligibility', () => {
  it('rejects a published event once its start time has passed even when its ticket sale end is open-ended', async () => {
    const module = await import('../src/checkout/checkout-eligibility.js');

    expect(() => module.assertEventCheckoutEligibility({
      startAt: new Date('2030-01-01T12:00:00.000Z'),
      now: new Date('2030-01-01T12:00:00.000Z'),
    })).toThrow('event sales are unavailable');
  });

  it('allows checkout before an event starts', async () => {
    const module = await import('../src/checkout/checkout-eligibility.js');

    expect(() => module.assertEventCheckoutEligibility({
      startAt: new Date('2030-01-01T12:00:00.000Z'),
      now: new Date('2030-01-01T11:59:59.999Z'),
    })).not.toThrow();
  });
});
