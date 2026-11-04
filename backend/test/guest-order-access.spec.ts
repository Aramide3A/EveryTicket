type GuestOrderAccess = {
  getGuestOrder(input: { database: GuestDatabase; orderReference: string; accessToken: string }): Promise<unknown>;
  getGuestTicketDownload(input: { database: GuestDatabase; orderReference: string; ticketId: string; accessToken: string; createDownloadUrl: (objectKey: string) => Promise<string> }): Promise<{ url: string } | null>;
};

type GuestDatabase = {
  order: { findFirst(input: unknown): Promise<unknown> };
  ticketDocumentJob: { findFirst(input: unknown): Promise<{ objectKey: string } | null> };
};

async function loadGuestOrderAccess(): Promise<GuestOrderAccess | undefined> {
  try {
    return await import('../src/checkout/guest-order-access.js') as GuestOrderAccess;
  } catch {
    return undefined;
  }
}

describe('guest order capability access', () => {
  const tokenDigest = '5eb5678086e8c6bc8e27e18573fda4be57e29a7a48bad5b2d6c5fad8d4165440';
  const order = {
    reference: 'ET-guest-order',
    status: 'PAID',
    ticketSubtotalKobo: 2000,
    platformFeeKobo: 100,
    totalKobo: 2100,
    event: { title: 'Guest event', slug: 'guest-event', startAt: new Date('2032-03-01T10:00:00.000Z'), venue: 'Hall' },
    lines: [{ ticketTypeName: 'General', unitPriceKobo: 2000, quantity: 1 }],
    tickets: [{ id: 'ticket-1', ticketTypeName: 'General', holderName: 'Guest Buyer', status: 'ACTIVE', documentJob: { status: 'READY' } }],
  };

  it('returns guest order contents only when the separate capability matches an unclaimed order', async () => {
    const access = await loadGuestOrderAccess();
    expect(access).toBeDefined();
    if (!access) throw new Error('guest order access is unavailable');
    const database = capabilityDatabase(tokenDigest, order);

    await expect(access.getGuestOrder({ database, orderReference: 'ET-guest-order', accessToken: 'guest-secret-token' })).resolves.toEqual(order);
    await expect(access.getGuestOrder({ database, orderReference: 'ET-guest-order', accessToken: 'wrong-token' })).resolves.toBeNull();
  });

  it('creates a guest ticket download only for a matching order capability and ready ticket', async () => {
    const access = await loadGuestOrderAccess();
    expect(access).toBeDefined();
    if (!access) throw new Error('guest order access is unavailable');
    const database = capabilityDatabase(tokenDigest, order);

    await expect(access.getGuestTicketDownload({
      database,
      orderReference: 'ET-guest-order',
      ticketId: 'ticket-1',
      accessToken: 'guest-secret-token',
      createDownloadUrl: async (objectKey) => `https://download.example.test/${objectKey}`,
    })).resolves.toEqual({ url: 'https://download.example.test/tickets/ticket-1.pdf' });
    await expect(access.getGuestTicketDownload({ database, orderReference: 'ET-guest-order', ticketId: 'ticket-1', accessToken: 'wrong-token', createDownloadUrl: async () => 'unsafe' })).resolves.toBeNull();
  });
});

function capabilityDatabase(expectedDigest: string, order: unknown): GuestDatabase {
  return {
    order: {
      findFirst: async (input) => {
        const where = (input as { where?: Record<string, unknown> }).where;
        return where?.reference === 'ET-guest-order' && where.customerProfileId === null && where.guestAccessTokenDigest === expectedDigest ? order : null;
      },
    },
    ticketDocumentJob: {
      findFirst: async (input) => {
        const where = (input as { where?: { ticketId?: string; status?: string; ticket?: { order?: Record<string, unknown> } } }).where;
        const orderWhere = where?.ticket?.order;
        return where?.ticketId === 'ticket-1' && where.status === 'READY' && orderWhere?.reference === 'ET-guest-order' && orderWhere.customerProfileId === null && orderWhere.guestAccessTokenDigest === expectedDigest
          ? { objectKey: 'tickets/ticket-1.pdf' }
          : null;
      },
    },
  };
}
