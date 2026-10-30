import { createHmac } from 'node:crypto';

type HandleWebhook = (input: {
  rawBody: Buffer;
  signature: string | undefined;
  secret: string;
  onChargeSuccess(reference: string): Promise<void>;
}) => Promise<{ accepted: boolean }>;

async function loadHandleWebhook(): Promise<HandleWebhook | undefined> {
  try {
    return (await import('../src/payments/paystack-webhook.js')).handlePaystackWebhook;
  } catch {
    return undefined;
  }
}

describe('Paystack webhook handling', () => {
  it('accepts only a signed charge.success body and forwards its reference', async () => {
    const handlePaystackWebhook = await loadHandleWebhook();
    const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'pay-123' } }));
    const secret = 'test-paystack-secret';
    const signature = createHmac('sha512', secret).update(rawBody).digest('hex');
    const references: string[] = [];

    expect(handlePaystackWebhook).toBeDefined();
    await expect(
      handlePaystackWebhook?.({
        rawBody,
        signature,
        secret,
        onChargeSuccess: async (reference) => {
          references.push(reference);
        },
      }),
    ).resolves.toEqual({ accepted: true });
    expect(references).toEqual(['pay-123']);
  });

  it('rejects altered or unsigned bodies before parsing them', async () => {
    const handlePaystackWebhook = await loadHandleWebhook();
    const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'pay-123' } }));

    expect(handlePaystackWebhook).toBeDefined();
    await expect(
      handlePaystackWebhook?.({
        rawBody,
        signature: 'not-a-valid-signature',
        secret: 'test-paystack-secret',
        onChargeSuccess: async () => undefined,
      }),
    ).rejects.toThrow('signature');
  });

  it('acknowledges non-payment events without sending them to payment finalization', async () => {
    const handlePaystackWebhook = await loadHandleWebhook();
    const secret = 'test-paystack-secret';
    const rawBody = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { reference: 'not-a-payment' } }));
    const signature = createHmac('sha512', secret).update(rawBody).digest('hex');

    expect(handlePaystackWebhook).toBeDefined();
    await expect(
      handlePaystackWebhook?.({
        rawBody,
        signature,
        secret,
        onChargeSuccess: async () => {
          throw new Error('should not be called');
        },
      }),
    ).resolves.toEqual({ accepted: true });
  });
});
