type EmailTemplatesModule = {
  encodeEmailPayload(input: Record<string, unknown>): string;
  renderNotificationEmail(input: {
    type: string;
    content?: string | null;
    publicAppUrl: string;
  }): { subject: string; text: string; html: string };
};

async function loadEmailTemplates(): Promise<EmailTemplatesModule | undefined> {
  try {
    return await import('../src/worker/email-templates.js') as EmailTemplatesModule;
  } catch {
    return undefined;
  }
}

describe('EveryTicket transactional email templates', () => {
  it('renders a role-aware welcome email with the organizer action', async () => {
    const templates = await loadEmailTemplates();
    expect(templates).toBeDefined();
    if (!templates) throw new Error('email templates are unavailable');

    const email = templates.renderNotificationEmail({
      type: 'WELCOME',
      publicAppUrl: 'https://everyticket.example',
      content: templates.encodeEmailPayload({ name: 'Amina', role: 'ORGANIZER' }),
    });

    expect(email.subject).toBe('Welcome to EveryTicket');
    expect(email.text).toContain('Create event');
    expect(email.html).toContain('Create event');
    expect(email.html).toContain('#ff9700');
  });

  it('renders an order email with a factual summary and a safe ticket link', async () => {
    const templates = await loadEmailTemplates();
    expect(templates).toBeDefined();
    if (!templates) throw new Error('email templates are unavailable');

    const email = templates.renderNotificationEmail({
      type: 'ORDER_CONFIRMATION',
      publicAppUrl: 'https://everyticket.example',
      content: templates.encodeEmailPayload({
        buyerName: 'Amina', eventTitle: 'Afrobeats at Sunset', orderReference: 'ET-123',
        totalKobo: 1850000, ticketLines: [{ name: 'Regular', quantity: 2 }],
      }),
    });

    expect(email.subject).toContain('Afrobeats at Sunset');
    expect(email.text).toContain('ET-123');
    expect(email.html).toContain('NGN 18,500.00');
    expect(email.html).toContain('https://everyticket.example/my-tickets');
  });

  it('keeps untrusted notification content out of the email markup', async () => {
    const templates = await loadEmailTemplates();
    expect(templates).toBeDefined();
    if (!templates) throw new Error('email templates are unavailable');

    const email = templates.renderNotificationEmail({
      type: 'ACCOUNT_RESTRICTED',
      publicAppUrl: 'https://everyticket.example',
      content: templates.encodeEmailPayload({ name: '<img src=x onerror=alert(1)>', reason: '<script>alert(1)</script>' }),
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;img');
  });

  it.each([
    'ORDER_CONFIRMATION', 'PAYMENT_FAILED', 'REFUND_REQUEST_RECEIVED', 'REFUND_DECISION',
    'PAYOUT_REQUEST_RECEIVED', 'PAYOUT_DECISION', 'EVENT_PUBLISHED', 'EVENT_CANCELLED',
    'RSVP_CONFIRMATION', 'RSVP_DECLINED', 'CHECK_IN_CONFIRMATION', 'ACCOUNT_RESTRICTED', 'ACCOUNT_RESTORED',
  ])('renders the %s notification as an actionable branded email', async (type) => {
    const templates = await loadEmailTemplates();
    expect(templates).toBeDefined();
    if (!templates) throw new Error('email templates are unavailable');

    const email = templates.renderNotificationEmail({
      type,
      publicAppUrl: 'https://everyticket.example',
      content: templates.encodeEmailPayload({ name: 'Amina', eventTitle: 'Afrobeats at Sunset', orderReference: 'ET-123', amountKobo: 500000, status: 'APPROVED', role: 'ORGANIZER' }),
    });

    expect(email.subject).not.toBe('An update from EveryTicket');
    expect(email.html).toContain('EveryTicket');
    expect(email.html).toContain('href=');
  });
});
