import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type CreateCheckoutOrder = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  eventId: string;
  reference: string;
  buyer: { name: string; email: string };
  items: Array<{ ticketTypeId: string; quantity: number }>;
  now: Date;
  holdExpiresAt: Date;
}) => Promise<{ reference: string; totalKobo: number }>;

type PaymentGateway = {
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
};

type InitializePayment = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  gateway: PaymentGateway;
  orderReference: string;
  paymentReference: string;
  now: Date;
}) => Promise<{ reference: string; authorizationUrl: string; accessCode: string }>;

type ProcessVerifiedPayment = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  gateway: PaymentGateway;
  paymentReference: string;
  now: Date;
}) => Promise<
  | { orderStatus: 'PAID'; ticketsIssued: number }
  | { orderStatus: 'PENDING_PAYMENT' }
  | { orderStatus: 'PAID_NEEDS_RESOLUTION'; ticketsIssued: 0 }
>;

type ReconcilePendingPayments = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  gateway: PaymentGateway;
  now: Date;
}) => Promise<{ checked: number; paid: number; needsResolution: number }>;

async function loadDependencies(): Promise<{
  createCheckoutOrder?: CreateCheckoutOrder;
  initializePayment?: InitializePayment;
  processVerifiedPayment?: ProcessVerifiedPayment;
  reconcilePendingPayments?: ReconcilePendingPayments;
}> {
  try {
    const [checkout, payments] = await Promise.all([
      import('../src/checkout/checkout-order.js'),
      import('../src/payments/payment-lifecycle.js'),
    ]);
    return {
      createCheckoutOrder: checkout.createCheckoutOrder,
      initializePayment: payments.initializePayment,
      processVerifiedPayment: payments.processVerifiedPayment,
      reconcilePendingPayments: payments.reconcilePendingPayments,
    };
  } catch {
    return {};
  }
}

describe('payment lifecycle', () => {
  const ids: Record<string, string | undefined> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.orderId) {
        await client.$executeRaw`DELETE FROM payment_attempt WHERE "orderId" = ${ids.orderId}`;
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

  it('stores expected server-side payment values before returning Paystack checkout authorization', async () => {
    const { createCheckoutOrder, initializePayment } = await loadDependencies();
    const databaseUrl = process.env.DATABASE_URL;
    expect(createCheckoutOrder).toBeDefined();
    expect(initializePayment).toBeDefined();
    if (!createCheckoutOrder || !initializePayment || !databaseUrl) throw new Error('payment dependencies are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const order = await createPaidOrder(client, ids, createCheckoutOrder);
    const received: Array<{ reference: string; email: string; amountKobo: number; currency: string }> = [];
    const gateway: PaymentGateway = {
      async initializeTransaction(input) {
        received.push(input);
        return { authorizationUrl: 'https://checkout.paystack.test/one', accessCode: 'access-one' };
      },
      async verifyTransaction() {
        throw new Error('not used');
      },
    };

    await expect(
      initializePayment({
        database: client,
        gateway,
        orderReference: order.reference,
        paymentReference: `pay-${randomUUID()}`,
        now: new Date('2032-01-01T10:00:05.000Z'),
      }),
    ).resolves.toEqual(expect.objectContaining({ authorizationUrl: 'https://checkout.paystack.test/one' }));

    expect(received).toEqual([
      expect.objectContaining({ email: 'buyer@example.test', amountKobo: 1_500, currency: 'NGN' }),
    ]);
    const attempts = await client.paymentAttempt.findMany({ where: { orderId: ids.orderId } });
    expect(attempts).toEqual([
      expect.objectContaining({ expectedAmountKobo: 1_523, currency: 'NGN', status: 'INITIALIZED' }),
    ]);
  });

  it('issues tickets only after Paystack server verification matches the stored amount and currency', async () => {
    const { createCheckoutOrder, initializePayment, processVerifiedPayment } = await loadDependencies();
    const databaseUrl = process.env.DATABASE_URL;
    expect(createCheckoutOrder).toBeDefined();
    expect(initializePayment).toBeDefined();
    expect(processVerifiedPayment).toBeDefined();
    if (!createCheckoutOrder || !initializePayment || !processVerifiedPayment || !databaseUrl) throw new Error('payment dependencies are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const order = await createPaidOrder(client, ids, createCheckoutOrder);
    const paymentReference = `pay-${randomUUID()}`;
    const gateway: PaymentGateway = {
      async initializeTransaction() {
        return { authorizationUrl: 'https://checkout.paystack.test/two', accessCode: 'access-two' };
      },
      async verifyTransaction(reference) {
        return {
          reference,
          gatewayTransactionId: `gateway-${randomUUID()}`,
          status: 'success',
          amountKobo: 1_523,
          currency: 'NGN',
          paidAt: new Date('2032-01-01T10:01:00.000Z'),
        };
      },
    };
    await initializePayment({ database: client, gateway, orderReference: order.reference, paymentReference, now: new Date() });

    await expect(
      processVerifiedPayment({ database: client, gateway, paymentReference, now: new Date('2032-01-01T10:02:00.000Z') }),
    ).resolves.toEqual({ orderStatus: 'PAID', ticketsIssued: 1 });
    await expect(
      processVerifiedPayment({ database: client, gateway, paymentReference, now: new Date('2032-01-01T10:02:00.000Z') }),
    ).resolves.toEqual({ orderStatus: 'PAID', ticketsIssued: 1 });

    const orderState = await client.order.findUniqueOrThrow({ where: { id: ids.orderId } });
    const tickets = await client.ticket.count({ where: { orderId: ids.orderId } });
    expect(orderState.status).toBe('PAID');
    expect(tickets).toBe(1);
  });

  it('quarantines a successful gateway response whose amount or currency differs from the order', async () => {
    const { createCheckoutOrder, initializePayment, processVerifiedPayment } = await loadDependencies();
    const databaseUrl = process.env.DATABASE_URL;
    expect(createCheckoutOrder).toBeDefined();
    expect(initializePayment).toBeDefined();
    expect(processVerifiedPayment).toBeDefined();
    if (!createCheckoutOrder || !initializePayment || !processVerifiedPayment || !databaseUrl) throw new Error('payment dependencies are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const order = await createPaidOrder(client, ids, createCheckoutOrder);
    const paymentReference = `pay-${randomUUID()}`;
    const gateway: PaymentGateway = {
      async initializeTransaction() {
        return { authorizationUrl: 'https://checkout.paystack.test/three', accessCode: 'access-three' };
      },
      async verifyTransaction(reference) {
        return {
          reference,
          gatewayTransactionId: `gateway-${randomUUID()}`,
          status: 'success',
          amountKobo: 1_499,
          currency: 'NGN',
        };
      },
    };
    await initializePayment({ database: client, gateway, orderReference: order.reference, paymentReference, now: new Date() });

    await expect(
      processVerifiedPayment({ database: client, gateway, paymentReference, now: new Date() }),
    ).rejects.toThrow('amount or currency');
    const payment = await client.paymentAttempt.findUniqueOrThrow({ where: { reference: paymentReference } });
    const orderState = await client.order.findUniqueOrThrow({ where: { id: ids.orderId } });
    expect(payment.status).toBe('VERIFIED_FAILED');
    expect(orderState.status).toBe('PAID_NEEDS_RESOLUTION');
    expect(await client.ticket.count({ where: { orderId: ids.orderId } })).toBe(0);
  });

  it('reconciles initialized attempts through the same verification and ticket-issuance path', async () => {
    const { createCheckoutOrder, initializePayment, reconcilePendingPayments } = await loadDependencies();
    const databaseUrl = process.env.DATABASE_URL;
    expect(createCheckoutOrder).toBeDefined();
    expect(initializePayment).toBeDefined();
    expect(reconcilePendingPayments).toBeDefined();
    if (!createCheckoutOrder || !initializePayment || !reconcilePendingPayments || !databaseUrl) throw new Error('payment dependencies are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const order = await createPaidOrder(client, ids, createCheckoutOrder);
    const paymentReference = `pay-${randomUUID()}`;
    const gateway: PaymentGateway = {
      async initializeTransaction() {
        return { authorizationUrl: 'https://checkout.paystack.test/four', accessCode: 'access-four' };
      },
      async verifyTransaction(reference) {
        return {
          reference,
          gatewayTransactionId: `gateway-${randomUUID()}`,
          status: 'success',
          amountKobo: 1_500,
          currency: 'NGN',
          paidAt: new Date('2032-01-01T10:01:00.000Z'),
        };
      },
    };
    await initializePayment({ database: client, gateway, orderReference: order.reference, paymentReference, now: new Date() });

    await expect(
      reconcilePendingPayments({ database: client, gateway, now: new Date('2032-01-01T10:02:00.000Z') }),
    ).resolves.toEqual({ checked: 1, paid: 1, needsResolution: 0 });
    expect((await client.order.findUniqueOrThrow({ where: { id: ids.orderId } })).status).toBe('PAID');
  });

  it('does not issue tickets automatically when Paystack records payment after the inventory hold expired', async () => {
    const { createCheckoutOrder, initializePayment, processVerifiedPayment } = await loadDependencies();
    const databaseUrl = process.env.DATABASE_URL;
    expect(createCheckoutOrder).toBeDefined();
    expect(initializePayment).toBeDefined();
    expect(processVerifiedPayment).toBeDefined();
    if (!createCheckoutOrder || !initializePayment || !processVerifiedPayment || !databaseUrl) throw new Error('payment dependencies are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const order = await createPaidOrder(client, ids, createCheckoutOrder);
    const paymentReference = `pay-${randomUUID()}`;
    const gateway: PaymentGateway = {
      async initializeTransaction() {
        return { authorizationUrl: 'https://checkout.paystack.test/late', accessCode: 'access-late' };
      },
      async verifyTransaction(reference) {
        return {
          reference,
          gatewayTransactionId: `gateway-${randomUUID()}`,
          status: 'success',
          amountKobo: 1_500,
          currency: 'NGN',
          paidAt: new Date('2032-01-01T10:11:00.000Z'),
        };
      },
    };
    await initializePayment({ database: client, gateway, orderReference: order.reference, paymentReference, now: new Date() });

    await expect(
      processVerifiedPayment({ database: client, gateway, paymentReference, now: new Date('2032-01-01T10:12:00.000Z') }),
    ).resolves.toEqual({ orderStatus: 'PAID_NEEDS_RESOLUTION', ticketsIssued: 0 });
    expect((await client.order.findUniqueOrThrow({ where: { id: ids.orderId } })).status).toBe('PAID_NEEDS_RESOLUTION');
    expect(await client.ticket.count({ where: { orderId: ids.orderId } })).toBe(0);
  });
});

async function createPaidOrder(
  client: ReturnType<typeof createDatabaseClient>,
  ids: Record<string, string | undefined>,
  createCheckoutOrder: CreateCheckoutOrder,
): Promise<{ reference: string; totalKobo: number }> {
  const order = await createCheckoutOrder({
    database: client,
    eventId: ids.eventId as string,
    reference: `order-${randomUUID()}`,
    buyer: { name: 'Paying attendee', email: 'buyer@example.test' },
    items: [{ ticketTypeId: ids.ticketTypeId as string, quantity: 1 }],
    now: new Date('2032-01-01T10:00:00.000Z'),
    holdExpiresAt: new Date('2032-01-01T10:10:00.000Z'),
  });
  ids.orderId = (await client.order.findUniqueOrThrow({ where: { reference: order.reference } })).id;
  return order;
}

async function createFixture(
  client: ReturnType<typeof createDatabaseClient>,
  ids: Record<string, string | undefined>,
): Promise<void> {
  Object.assign(ids, {
    userId: randomUUID(), profileId: randomUUID(), categoryId: randomUUID(), eventId: randomUUID(),
    ticketTypeId: randomUUID(), feeRuleId: randomUUID(),
  });
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
    VALUES (${ids.categoryId}, ${`Payment ${ids.categoryId}`}, ${`payment-${ids.categoryId}`}, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt")
    VALUES (${ids.eventId}, ${ids.profileId}, ${ids.categoryId}, 'Payment event', ${`payment-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', '2031-12-31T10:00:00.000Z', NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt")
    VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'Entry', 1000, 5, true, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "appliesToFreeOrder", "createdAt")
    VALUES (${ids.feeRuleId}, ${Number(`8${Date.now().toString().slice(-5)}`)}, 'FIXED', 500, '2031-12-01T00:00:00.000Z', false, NOW())
  `;
}

describe('payment HTTP boundaries', () => {
  let app: INestApplication | undefined;
  let originalDatabaseUrl: string | undefined;
  let originalPaystackSecret: string | undefined;

  beforeEach(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.PAYSTACK_SECRET_KEY;
    app = await createApi();
  });

  afterEach(async () => {
    await app?.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPaystackSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret;
    app = undefined;
  });

  it('refuses payment initialization without server-side payment configuration', async () => {
    await request(app?.getHttpServer())
      .post('/orders/order-reference/payments')
      .expect(503, { message: 'payments are not configured', error: 'Service Unavailable', statusCode: 503 });
  });

  it('allows a guest to retry payment initialization by high-entropy order reference', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_configured_for_http_contract';

    await request(app?.getHttpServer())
      .post('/orders/order-reference/payments')
      .expect(503);
  });

  it('provides a callback-safe refresh route without allowing the browser to mark an order paid itself', async () => {
    await request(app?.getHttpServer())
      .post('/payments/pay-reference/reconcile')
      .expect(503, { message: 'payments are not configured', error: 'Service Unavailable', statusCode: 503 });
  });

  it('does not allow an unauthenticated caller to reconcile a payment reference', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_configured_for_http_contract';

    await request(app?.getHttpServer())
      .post('/payments/pay-reference/reconcile')
      .expect(401);
  });
});

describe('payment reconciliation configuration', () => {
  it('uses a five-minute reconciliation interval by default', async () => {
    const { readPaymentReconciliationInterval } = await import('../src/payments/reconciliation-config.js');

    expect(readPaymentReconciliationInterval(undefined)).toBe(300_000);
  });

  it.each(['0', '-1', '500.5', 'invalid'])('rejects an unsafe reconciliation interval %s', async (value) => {
    const { readPaymentReconciliationInterval } = await import('../src/payments/reconciliation-config.js');

    expect(() => readPaymentReconciliationInterval(value)).toThrow();
  });
});
