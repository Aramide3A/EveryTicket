import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type CreateCheckoutOrder = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  eventId: string;
  reference: string;
  buyer: { name: string; email: string; phone?: string };
  items: Array<{ ticketTypeId: string; quantity: number }>;
  now: Date;
  holdExpiresAt: Date;
}) => Promise<{
  reference: string;
  status: 'PENDING_PAYMENT' | 'PAID';
  ticketSubtotalKobo: number;
  platformFeeKobo: number;
  totalKobo: number;
  paystackFeeKobo: number;
  paystackChargeKobo: number;
  guestAccessToken?: string;
}>;

type FinalizePaidOrder = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  paymentReference: string;
  gatewayTransactionId: string;
  paidAt: Date;
}) => Promise<
  | { orderStatus: 'PAID'; ticketsIssued: number }
  | { orderStatus: 'PAID_NEEDS_RESOLUTION'; ticketsIssued: 0 }
>;

async function loadCreateCheckoutOrder(): Promise<CreateCheckoutOrder | undefined> {
  try {
    const module = await import('../src/checkout/checkout-order.js');
    return module.createCheckoutOrder;
  } catch {
    return undefined;
  }
}

async function loadFinalizePaidOrder(): Promise<FinalizePaidOrder | undefined> {
  try {
    const module = await import('../src/payments/finalize-paid-order.js');
    return module.finalizePaidOrder;
  } catch {
    return undefined;
  }
}

describe('checkout order creation', () => {
  const ids: Record<string, string | undefined> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.orderId) {
        if (ids.paymentAttemptId) {
          await client.$executeRaw`DELETE FROM payment_attempt WHERE id = ${ids.paymentAttemptId}`;
        }
        await client.$executeRaw`DELETE FROM notification_job WHERE "orderId" = ${ids.orderId}`;
        await client.$executeRaw`DELETE FROM ticket_document_job WHERE "ticketId" IN (SELECT id FROM ticket WHERE "orderId" = ${ids.orderId})`;
        await client.$executeRaw`DELETE FROM ticket WHERE "orderId" = ${ids.orderId}`;
        await client.$executeRaw`DELETE FROM inventory_hold WHERE "orderId" = ${ids.orderId}`;
        await client.$executeRaw`DELETE FROM order_line WHERE "orderId" = ${ids.orderId}`;
        await client.$executeRaw`DELETE FROM "order" WHERE id = ${ids.orderId}`;
      }
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.ticketTypeId) await client.$executeRaw`DELETE FROM ticket_type WHERE id = ${ids.ticketTypeId}`;
      if (ids.eventId) await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      if (ids.userId) await client.$executeRaw`DELETE FROM auth_user WHERE id = ${ids.userId}`;
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('confirms a free order and issues its ticket without creating a payment hold', async () => {
    const createCheckoutOrder = await loadCreateCheckoutOrder();
    const databaseUrl = process.env.DATABASE_URL;

    expect(createCheckoutOrder).toBeDefined();
    if (!createCheckoutOrder || !databaseUrl) {
      throw new Error('checkout order creation dependencies are unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFreeEventFixture(client, ids);

    const result = await createCheckoutOrder({
      database: client,
      eventId: ids.eventId as string,
      reference: `ET-${randomUUID()}`,
      buyer: { name: 'Free attendee', email: 'attendee@example.test' },
      items: [{ ticketTypeId: ids.ticketTypeId as string, quantity: 1 }],
      now: new Date('2032-01-01T10:00:00.000Z'),
      holdExpiresAt: new Date('2032-01-01T10:10:00.000Z'),
    });
    ids.orderId = (await client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "order" WHERE reference = ${result.reference}
    `)[0]?.id;

    expect(result).toEqual({
      reference: result.reference,
      status: 'PAID',
      ticketSubtotalKobo: 0,
      platformFeeKobo: 0,
      totalKobo: 0,
      paystackFeeKobo: 0,
      paystackChargeKobo: 0,
      guestAccessToken: expect.any(String),
    });
    const [order] = await client.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM "order" WHERE id = ${ids.orderId}
    `;
    const tickets = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM ticket WHERE "orderId" = ${ids.orderId}
    `;
    const holds = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM inventory_hold WHERE "orderId" = ${ids.orderId}
    `;

    expect(order).toEqual({ status: 'PAID' });
    expect(tickets).toEqual([{ count: 1 }]);
    expect(holds).toEqual([{ count: 0 }]);
  });

  it('creates a paid order with an expiring hold and no ticket before payment', async () => {
    const createCheckoutOrder = await loadCreateCheckoutOrder();
    const databaseUrl = process.env.DATABASE_URL;

    expect(createCheckoutOrder).toBeDefined();
    if (!createCheckoutOrder || !databaseUrl) {
      throw new Error('checkout order creation dependencies are unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFreeEventFixture(client, ids, 1_000);

    const result = await createCheckoutOrder({
      database: client,
      eventId: ids.eventId as string,
      reference: `ET-${randomUUID()}`,
      buyer: { name: 'Paying attendee', email: 'paying@example.test' },
      items: [{ ticketTypeId: ids.ticketTypeId as string, quantity: 1 }],
      now: new Date('2032-01-01T10:00:00.000Z'),
      holdExpiresAt: new Date('2032-01-01T10:10:00.000Z'),
    });
    ids.orderId = (await client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "order" WHERE reference = ${result.reference}
    `)[0]?.id;

    expect(result).toEqual({
      reference: result.reference,
      status: 'PENDING_PAYMENT',
      ticketSubtotalKobo: 1_000,
      platformFeeKobo: 500,
      totalKobo: 1_500,
      paystackFeeKobo: 23,
      paystackChargeKobo: 1_523,
      guestAccessToken: expect.any(String),
    });
    const [order] = await client.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM "order" WHERE id = ${ids.orderId}
    `;
    const tickets = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM ticket WHERE "orderId" = ${ids.orderId}
    `;
    const holds = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM inventory_hold WHERE "orderId" = ${ids.orderId}
    `;

    expect(order).toEqual({ status: 'PENDING_PAYMENT' });
    expect(tickets).toEqual([{ count: 0 }]);
    expect(holds).toEqual([{ count: 1 }]);

    const paymentAttemptId = randomUUID();
    const paymentReference = `pay-${randomUUID()}`;
    await client.$executeRaw`
      INSERT INTO payment_attempt (
        id, "orderId", reference, "expectedAmountKobo", currency, status, "createdAt"
      )
      VALUES (${paymentAttemptId}, ${ids.orderId}, ${paymentReference}, 1500, 'NGN', 'INITIALIZED', NOW())
    `;
    ids.paymentAttemptId = paymentAttemptId;
    await expect(
      client.$executeRaw`
        INSERT INTO payment_attempt (
          id, "orderId", reference, "expectedAmountKobo", currency, status, "createdAt"
        )
        VALUES (${randomUUID()}, ${ids.orderId}, ${paymentReference}, 1500, 'NGN', 'INITIALIZED', NOW())
      `,
    ).rejects.toThrow();

    const finalizePaidOrder = await loadFinalizePaidOrder();
    expect(finalizePaidOrder).toBeDefined();
    if (!finalizePaidOrder) {
      throw new Error('payment finalization is unavailable');
    }
    const firstFinalization = await finalizePaidOrder({
      database: client,
      paymentReference,
      gatewayTransactionId: `gateway-${randomUUID()}`,
      paidAt: new Date('2032-01-01T10:01:00.000Z'),
    });
    const replayFinalization = await finalizePaidOrder({
      database: client,
      paymentReference,
      gatewayTransactionId: `gateway-${randomUUID()}`,
      paidAt: new Date('2032-01-01T10:01:00.000Z'),
    });
    expect(firstFinalization).toEqual({ orderStatus: 'PAID', ticketsIssued: 1 });
    expect(replayFinalization).toEqual({ orderStatus: 'PAID', ticketsIssued: 1 });

    const [paidOrder] = await client.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM "order" WHERE id = ${ids.orderId}
    `;
    const issuedTickets = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM ticket WHERE "orderId" = ${ids.orderId}
    `;
    const remainingHolds = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM inventory_hold WHERE "orderId" = ${ids.orderId}
    `;
    const confirmationJobs = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM notification_job WHERE "orderId" = ${ids.orderId}
    `;
    const ticketDocumentJobs = await client.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::INTEGER AS count FROM ticket_document_job
      WHERE "ticketId" IN (SELECT id FROM ticket WHERE "orderId" = ${ids.orderId})
    `;
    expect(paidOrder).toEqual({ status: 'PAID' });
    expect(issuedTickets).toEqual([{ count: 1 }]);
    expect(remainingHolds).toEqual([{ count: 0 }]);
    expect(confirmationJobs).toEqual([{ count: 1 }]);
    expect(ticketDocumentJobs).toEqual([{ count: 1 }]);
  });
});

async function createFreeEventFixture(
  client: ReturnType<typeof createDatabaseClient>,
  ids: Record<string, string | undefined>,
  priceKobo = 0,
): Promise<void> {
  ids.userId = randomUUID();
  ids.categoryId = randomUUID();
  ids.eventId = randomUUID();
  ids.profileId = randomUUID();
  ids.ticketTypeId = randomUUID();
  ids.feeRuleId = randomUUID();
  await client.$executeRaw`
    INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (${ids.userId}, 'Organizer', ${`${ids.userId}@example.test`}, false, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt")
    VALUES (${ids.profileId}, ${ids.userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt")
    VALUES (${ids.categoryId}, ${`Free ${ids.categoryId}`}, ${`free-${ids.categoryId}`}, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO event (
      id, "organizerProfileId", "categoryId", title, slug, description, city, state,
      venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt"
    ) VALUES (
      ${ids.eventId}, ${ids.profileId}, ${ids.categoryId}, 'Free event', ${`free-event-${ids.eventId}`},
      'Test description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos',
      '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED',
      '2031-12-31T10:00:00.000Z', NOW(), NOW()
    )
  `;
  await client.$executeRaw`
    INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt")
    VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'Free entry', ${priceKobo}, 5, true, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "appliesToFreeOrder", "createdAt")
    VALUES (${ids.feeRuleId}, 900001, 'FIXED', 500, '2031-12-01T00:00:00.000Z', false, NOW())
  `;
}

describe('guest checkout account linking', () => {
  it('uses a matching active profile id and leaves an unknown email unlinked', async () => {
    const checkout = await import('../src/checkout/guest-checkout-account-link.js');

    expect(checkout.guestCheckoutProfileId({ id: 'profile-1' })).toBe('profile-1');
    expect(checkout.guestCheckoutProfileId(null)).toBeUndefined();
  });

  it('normalizes valid buyer email addresses and rejects malformed values', async () => {
    const checkout = await import('../src/checkout/guest-checkout-account-link.js');

    expect(checkout.normalizeBuyerEmail(' Buyer@Example.COM ')).toBe('buyer@example.com');
    expect(checkout.normalizeBuyerEmail('not-an-email')).toBeNull();
    expect(checkout.normalizeBuyerEmail('   ')).toBeNull();
  });
});
