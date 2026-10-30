type PlatformFeeCalculator = (input: {
  amountKobo: number;
  rule:
    | { type: 'FIXED'; amountKobo: number }
    | { type: 'PERCENTAGE'; basisPoints: number };
}) => number;

async function loadCalculator(): Promise<PlatformFeeCalculator | undefined> {
  try {
    const module = await import('../src/checkout/platform-fee.js');
    return module.calculatePlatformFeeKobo;
  } catch {
    return undefined;
  }
}

describe('calculatePlatformFeeKobo', () => {
  it('returns a fixed fee unchanged', async () => {
    const calculatePlatformFeeKobo = await loadCalculator();

    expect(calculatePlatformFeeKobo).toBeDefined();
    expect(
      calculatePlatformFeeKobo?.({
        amountKobo: 12_000,
        rule: { type: 'FIXED', amountKobo: 500 },
      }),
    ).toBe(500);
  });

  it('rounds percentage fees to the nearest kobo', async () => {
    const calculatePlatformFeeKobo = await loadCalculator();

    expect(calculatePlatformFeeKobo).toBeDefined();
    expect(
      calculatePlatformFeeKobo?.({
        amountKobo: 101,
        rule: { type: 'PERCENTAGE', basisPoints: 250 },
      }),
    ).toBe(3);
    expect(
      calculatePlatformFeeKobo?.({
        amountKobo: 99,
        rule: { type: 'PERCENTAGE', basisPoints: 250 },
      }),
    ).toBe(2);
  });

  it('rounds an exact half-kobo percentage fee up', async () => {
    const calculatePlatformFeeKobo = await loadCalculator();

    expect(calculatePlatformFeeKobo).toBeDefined();
    expect(
      calculatePlatformFeeKobo?.({
        amountKobo: 100,
        rule: { type: 'PERCENTAGE', basisPoints: 250 },
      }),
    ).toBe(3);
  });

  it.each([
    { amountKobo: -1, rule: { type: 'FIXED' as const, amountKobo: 0 } },
    { amountKobo: 100, rule: { type: 'FIXED' as const, amountKobo: -1 } },
    { amountKobo: 100, rule: { type: 'PERCENTAGE' as const, basisPoints: -1 } },
    { amountKobo: 100.5, rule: { type: 'PERCENTAGE' as const, basisPoints: 250 } },
  ])('rejects invalid kobo inputs: %o', async (input) => {
    const calculatePlatformFeeKobo = await loadCalculator();

    expect(calculatePlatformFeeKobo).toBeDefined();
    expect(() => calculatePlatformFeeKobo?.(input)).toThrow(
      'must be a non-negative safe integer',
    );
  });
});
