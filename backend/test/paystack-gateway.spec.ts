import { jest } from '@jest/globals';

type PaystackGatewayFactory = (input: {
  secretKey: string;
  fetchFn: typeof fetch;
}) => {
  initializeTransaction(input: {
    reference: string;
    email: string;
    amountKobo: number;
    currency: string;
  }): Promise<{ authorizationUrl: string; accessCode: string }>;
  verifyTransaction(reference: string): Promise<{
    reference: string;
    gatewayTransactionId: string;
    status: 'success' | 'failed' | 'pending';
    amountKobo: number;
    currency: string;
    paidAt?: Date;
  }>;
  createRefund(input: {
    transactionReference: string;
    amountKobo: number;
    currency: string;
    customerNote: string;
    merchantNote: string;
  }): Promise<{
    reference: string;
    status: 'pending' | 'processing' | 'needs-attention' | 'failed' | 'processed';
    amountKobo: number;
    currency: string;
  }>;
  fetchRefund(reference: string): Promise<{
    reference: string;
    status: 'pending' | 'processing' | 'needs-attention' | 'failed' | 'processed';
    amountKobo: number;
    currency: string;
  }>;
};

async function loadPaystackGatewayFactory(): Promise<PaystackGatewayFactory | undefined> {
  try {
    return (await import('../src/payments/paystack-gateway.js')).createPaystackGateway;
  } catch {
    return undefined;
  }
}

describe('Paystack gateway client', () => {
  it('initializes a transaction using the order total in kobo without a split instruction', async () => {
    const createPaystackGateway = await loadPaystackGatewayFactory();
    const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { authorization_url: 'https://checkout.paystack.test/abc', access_code: 'access-abc' },
        }),
        { status: 200 },
      ),
    );

    expect(createPaystackGateway).toBeDefined();
    const result = await createPaystackGateway?.({ secretKey: 'sk_test_example', fetchFn })
      .initializeTransaction({
        reference: 'pay-ref-1',
        email: 'buyer@example.test',
        amountKobo: 1_500,
        currency: 'NGN',
      });

    expect(result).toEqual({ authorizationUrl: 'https://checkout.paystack.test/abc', accessCode: 'access-abc' });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test_example' }),
        body: JSON.stringify({
          email: 'buyer@example.test',
          amount: 1_500,
          currency: 'NGN',
          reference: 'pay-ref-1',
        }),
      }),
    );
  });

  it('normalizes the server-to-server verification response', async () => {
    const createPaystackGateway = await loadPaystackGatewayFactory();
    const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: 'pay-ref-2',
            id: 713,
            status: 'success',
            amount: 2_250,
            currency: 'NGN',
            paid_at: '2032-01-01T10:02:00.000Z',
          },
        }),
        { status: 200 },
      ),
    );

    expect(createPaystackGateway).toBeDefined();
    const result = await createPaystackGateway?.({ secretKey: 'sk_test_example', fetchFn })
      .verifyTransaction('pay-ref-2');

    expect(result).toEqual({
      reference: 'pay-ref-2',
      gatewayTransactionId: '713',
      status: 'success',
      amountKobo: 2_250,
      currency: 'NGN',
      paidAt: new Date('2032-01-01T10:02:00.000Z'),
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/pay-ref-2',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk_test_example' }) }),
    );
  });

  it('initiates an exact partial refund against the successful transaction reference', async () => {
    const createPaystackGateway = await loadPaystackGatewayFactory();
    const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { id: 3018284, status: 'pending', amount: 2_100, currency: 'NGN' },
        }),
        { status: 200 },
      ),
    );

    expect(createPaystackGateway).toBeDefined();
    const result = await createPaystackGateway?.({ secretKey: 'sk_test_example', fetchFn })
      .createRefund({
        transactionReference: 'pay-ref-paid',
        amountKobo: 2_100,
        currency: 'NGN',
        customerNote: 'Approved customer refund',
        merchantNote: 'EverythingTicket refund refund-request-1',
      });

    expect(result).toEqual({ reference: '3018284', status: 'pending', amountKobo: 2_100, currency: 'NGN' });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.paystack.co/refund',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test_example' }),
        body: JSON.stringify({
          transaction: 'pay-ref-paid',
          amount: 2_100,
          currency: 'NGN',
          customer_note: 'Approved customer refund',
          merchant_note: 'EverythingTicket refund refund-request-1',
        }),
      }),
    );
  });

  it('retrieves the authoritative refund status by provider refund identifier', async () => {
    const createPaystackGateway = await loadPaystackGatewayFactory();
    const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { id: 3018284, status: 'processed', amount: 2_100, currency: 'NGN' },
        }),
        { status: 200 },
      ),
    );

    expect(createPaystackGateway).toBeDefined();
    await expect(createPaystackGateway?.({ secretKey: 'sk_test_example', fetchFn }).fetchRefund('3018284'))
      .resolves.toEqual({ reference: '3018284', status: 'processed', amountKobo: 2_100, currency: 'NGN' });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.paystack.co/refund/3018284',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk_test_example' }) }),
    );
  });
});
