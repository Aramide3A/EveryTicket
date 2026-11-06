import { quoteCheckout } from '../src/checkout/checkout-quote-service.js';

const now = new Date('2031-01-01T10:00:00.000Z');
const input = { eventId: 'missing-event', items: [{ ticketTypeId: 'missing-ticket', quantity: 1 }], now, holdTtlMs: 600_000 };

describe('quoteCheckout error responses', () => {
  it('returns not found for an event that cannot be purchased', async () => {
    const database = { event: { findFirst: async () => null } } as unknown as Parameters<typeof quoteCheckout>[0]['database'];

    await expect(quoteCheckout({ database, ...input })).rejects.toMatchObject({ status: 404 });
  });

  it('returns service unavailable when no platform fee rule is active', async () => {
    const database = {
      event: { findFirst: async () => ({ startAt: new Date('2032-01-01T10:00:00.000Z') }) },
      platformFeeRule: { findFirst: async () => null },
    } as unknown as Parameters<typeof quoteCheckout>[0]['database'];

    await expect(quoteCheckout({ database, ...input })).rejects.toMatchObject({ status: 503 });
  });

  it('returns not found for a ticket type that is unavailable', async () => {
    const database = {
      event: { findFirst: async () => ({ startAt: new Date('2032-01-01T10:00:00.000Z') }) },
      platformFeeRule: { findFirst: async () => ({ mode: 'FIXED', fixedAmountKobo: 0, appliesToFreeOrder: false }) },
      ticketType: { findMany: async () => [] },
    } as unknown as Parameters<typeof quoteCheckout>[0]['database'];

    await expect(quoteCheckout({ database, ...input })).rejects.toMatchObject({ status: 404 });
  });

  it('returns conflict when event sales have ended', async () => {
    const database = {
      event: { findFirst: async () => ({ startAt: now }) },
    } as unknown as Parameters<typeof quoteCheckout>[0]['database'];

    await expect(quoteCheckout({ database, ...input })).rejects.toMatchObject({ status: 409 });
  });

  it('returns conflict when the requested ticket quantity is unavailable', async () => {
    const database = {
      event: { findFirst: async () => ({ startAt: new Date('2032-01-01T10:00:00.000Z') }) },
      platformFeeRule: { findFirst: async () => ({ mode: 'FIXED', fixedAmountKobo: 0, appliesToFreeOrder: false }) },
      ticketType: { findMany: async () => [{ id: 'missing-ticket', priceKobo: 1000, maxPerOrder: 0, salesStartAt: null, salesEndAt: null }] },
    } as unknown as Parameters<typeof quoteCheckout>[0]['database'];

    await expect(quoteCheckout({ database, ...input })).rejects.toMatchObject({ status: 409 });
  });
});
