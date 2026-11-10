describe('Paystack customer charge', () => {
  it('calculates the gross amount Paystack adds for a Nigerian local payment', async () => {
    const module = await import('../src/payments/paystack-customer-charge.js');

    expect(module.calculatePaystackCustomerChargeKobo(1_050_000)).toEqual({
      paystackFeeKobo: 26_143,
      paystackChargeKobo: 1_076_143,
    });
    expect(module.calculatePaystackCustomerChargeKobo(1_260_000)).toEqual({
      paystackFeeKobo: 29_341,
      paystackChargeKobo: 1_289_341,
    });
  });

  it('does not add a Paystack fee to a free order', async () => {
    const module = await import('../src/payments/paystack-customer-charge.js');

    expect(module.calculatePaystackCustomerChargeKobo(0)).toEqual({
      paystackFeeKobo: 0,
      paystackChargeKobo: 0,
    });
  });
});
