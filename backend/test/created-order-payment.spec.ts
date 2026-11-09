describe('created order payment initialization', () => {
  it('returns the created guest order when payment initialization fails', async () => {
    const checkout = await import('../src/checkout/created-order-payment.js');
    const order = {
      reference: 'ET-order',
      status: 'PENDING_PAYMENT' as const,
      ticketSubtotalKobo: 1_000,
      platformFeeKobo: 50,
      totalKobo: 1_050,
      guestAccessToken: 'guest-private-capability',
    };

    await expect(
      checkout.withInitialPayment(order, async () => {
        throw new Error('provider unavailable');
      }),
    ).resolves.toEqual(order);
  });

  it('adds the initialized payment when the provider succeeds', async () => {
    const checkout = await import('../src/checkout/created-order-payment.js');
    const order = {
      reference: 'ET-order',
      status: 'PENDING_PAYMENT' as const,
      ticketSubtotalKobo: 1_000,
      platformFeeKobo: 50,
      totalKobo: 1_050,
    };
    const payment = {
      reference: 'ETP-payment',
      authorizationUrl: 'https://checkout.example.test/ETP-payment',
      accessCode: 'access-code',
    };

    await expect(
      checkout.withInitialPayment(order, async () => payment),
    ).resolves.toEqual({ ...order, payment });
  });
});
