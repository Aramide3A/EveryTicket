type TicketCredentialModule = {
  createTicketCredential(input: { ticketId: string; admissionTokenDigest: string; secret: string }): string;
  readTicketCredential(input: { token: string; admissionTokenDigest: string; secret: string }): string | null;
  createGuestCredential(input: { guestId: string; admissionTokenDigest: string; secret: string }): string;
  readGuestCredential(input: { token: string; admissionTokenDigest: string; secret: string }): string | null;
};

async function loadTicketCredential(): Promise<TicketCredentialModule | undefined> {
  try {
    return await import('../src/worker/ticket-credential.js') as TicketCredentialModule;
  } catch {
    return undefined;
  }
}

describe('signed ticket QR credentials', () => {
  it('creates an opaque ticket credential that only validates with the ticket digest and server secret', async () => {
    const credential = await loadTicketCredential();
    expect(credential).toBeDefined();
    if (!credential) throw new Error('ticket credentials are unavailable');
    const input = { ticketId: 'ticket_123', admissionTokenDigest: 'a'.repeat(64), secret: 'a-long-server-only-admission-secret' };
    const token = credential.createTicketCredential(input);

    expect(token).toMatch(/^et1\.ticket_123\.[A-Za-z0-9_-]+$/);
    expect(credential.readTicketCredential({ ...input, token })).toBe('ticket_123');
    expect(credential.readTicketCredential({ ...input, token: `${token}x` })).toBeNull();
    expect(credential.readTicketCredential({ ...input, admissionTokenDigest: 'b'.repeat(64), token })).toBeNull();
  });

  it('creates a distinct revocable guest credential tied to the current digest', async () => {
    const credential = await loadTicketCredential();
    expect(credential).toBeDefined();
    if (!credential) throw new Error('guest credentials are unavailable');
    const input = { guestId: 'guest_123', admissionTokenDigest: 'c'.repeat(64), secret: 'a-long-server-only-admission-secret' };
    const token = credential.createGuestCredential(input);

    expect(token).toMatch(/^eg1\.guest_123\.[A-Za-z0-9_-]+$/);
    expect(credential.readGuestCredential({ ...input, token })).toBe('guest_123');
    expect(credential.readGuestCredential({ ...input, admissionTokenDigest: 'd'.repeat(64), token })).toBeNull();
    expect(credential.readTicketCredential({ admissionTokenDigest: input.admissionTokenDigest, secret: input.secret, token })).toBeNull();
  });
});
