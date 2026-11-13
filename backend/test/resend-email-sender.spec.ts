type ResendEmailSenderModule = {
  createResendEmailSender(input: {
    config: { apiKey: string; from: string };
    client?: {
      emails: {
        send(message: { from: string; to: string; subject: string; text: string }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  }): { send(message: { to: string; subject: string; text: string }): Promise<void> };
};

async function loadResendEmailSender(): Promise<ResendEmailSenderModule | undefined> {
  try {
    return await import('../src/worker/resend-email-sender.js') as ResendEmailSenderModule;
  } catch {
    return undefined;
  }
}

describe('Resend email sender', () => {
  it('uses the configured sender identity and preserves the message content', async () => {
    const resend = await loadResendEmailSender();
    expect(resend).toBeDefined();
    if (!resend) throw new Error('Resend email sender is unavailable');
    const messages: Array<{ from: string; to: string; subject: string; text: string }> = [];
    const sender = resend.createResendEmailSender({
      config: { apiKey: 're_test', from: 'EverythingTicket <no-reply@example.test>' },
      client: { emails: { send: async (message) => { messages.push(message); return { data: { id: 'email_123' }, error: null }; } } },
    });

    await sender.send({ to: 'customer@example.test', subject: 'Order confirmed', text: 'Your order reference is ET-001.' });

    expect(messages).toEqual([{ from: 'EverythingTicket <no-reply@example.test>', to: 'customer@example.test', subject: 'Order confirmed', text: 'Your order reference is ET-001.' }]);
  });

  it('surfaces Resend delivery errors to the worker retry flow', async () => {
    const resend = await loadResendEmailSender();
    expect(resend).toBeDefined();
    if (!resend) throw new Error('Resend email sender is unavailable');
    const sender = resend.createResendEmailSender({
      config: { apiKey: 're_test', from: 'EverythingTicket <no-reply@example.test>' },
      client: { emails: { send: async () => ({ data: null, error: { message: 'Domain is not verified' } }) } },
    });

    await expect(sender.send({ to: 'customer@example.test', subject: 'Order confirmed', text: 'Your order reference is ET-001.' })).rejects.toThrow('Domain is not verified');
  });
});
