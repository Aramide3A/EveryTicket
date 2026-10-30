async function loadVerifier(): Promise<
  | ((input: { rawBody: Buffer; signature: string; secret: string }) => boolean)
  | undefined
> {
  try {
    const module = await import('../src/payments/paystack-signature.js');
    return module.verifyPaystackSignature;
  } catch {
    return undefined;
  }
}

describe('verifyPaystackSignature', () => {
  it('accepts only the HMAC-SHA512 signature for the unchanged raw webhook body', async () => {
    const verifyPaystackSignature = await loadVerifier();

    expect(verifyPaystackSignature).toBeDefined();
    expect(
      verifyPaystackSignature?.({
        rawBody: Buffer.from('{"event":"charge.success"}'),
        signature:
          'cc89381b2cef27c961e1b9b2a4034a3bdbda28623991b4fff1ffa6c68c849a346c4e51fcefe9c99431c3a181ea1032699655ca0104e21afefe1759b2827f89c4',
        secret: 'test-paystack-secret',
      }),
    ).toBe(true);
    expect(
      verifyPaystackSignature?.({
        rawBody: Buffer.from('{"event":"charge.failed"}'),
        signature:
          'cc89381b2cef27c961e1b9b2a4034a3bdbda28623991b4fff1ffa6c68c849a346c4e51fcefe9c99431c3a181ea1032699655ca0104e21afefe1759b2827f89c4',
        secret: 'test-paystack-secret',
      }),
    ).toBe(false);
  });
});
