type SmtpEmailSenderModule = {
  createSmtpEmailSender(input: {
    config: { host: string; port: number; user: string; password: string; from: string };
    transport?: { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
  }): { send(message: { to: string; subject: string; text: string }): Promise<void> };
};

async function loadSmtpEmailSender(): Promise<SmtpEmailSenderModule | undefined> {
  try {
    return await import('../src/worker/smtp-email-sender.js') as SmtpEmailSenderModule;
  } catch {
    return undefined;
  }
}

describe('SMTP email sender', () => {
  it('uses the configured sender identity and does not alter the recipient content', async () => {
    const smtp = await loadSmtpEmailSender();
    expect(smtp).toBeDefined();
    if (!smtp) throw new Error('SMTP sender is unavailable');
    const messages: Array<{ from: string; to: string; subject: string; text: string }> = [];
    const sender = smtp.createSmtpEmailSender({
      config: { host: 'smtp.example.test', port: 587, user: 'user', password: 'password', from: 'EverythingTicket <no-reply@example.test>' },
      transport: { sendMail: async (message) => { messages.push(message); } },
    });

    await sender.send({ to: 'customer@example.test', subject: 'Order confirmed', text: 'Your order reference is ET-001.' });

    expect(messages).toEqual([{ from: 'EverythingTicket <no-reply@example.test>', to: 'customer@example.test', subject: 'Order confirmed', text: 'Your order reference is ET-001.' }]);
  });
});
