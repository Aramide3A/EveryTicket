import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type CustomerTicketAccess = {
  listCustomerOrders(input: {
    database: ReturnType<typeof createDatabaseClient>;
    customerProfileId: string;
    status?: 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'PAID_NEEDS_RESOLUTION';
    page?: number;
    pageSize?: number;
  }): Promise<{ items: Array<{ reference: string; status: string; tickets: Array<{ id: string; ticketTypeName: string }> }>; page: number; pageSize: number; total: number; totalPages: number }>;
  listCustomerTickets(input: {
    database: ReturnType<typeof createDatabaseClient>;
    customerProfileId: string;
    admissionTokenSecret: string;
  }): Promise<Array<{ id: string; ticketTypeName: string; orderReference: string; holderName: string; holderEmail: string; status: string; checkedIn: boolean; admissionCredential: string; event: { id: string; title: string; slug: string; startAt: Date; endAt: Date; venue: string; address: string; timeZone: string } }>>;
  getCustomerTicket(input: {
    database: ReturnType<typeof createDatabaseClient>;
    customerProfileId: string;
    ticketId: string;
    admissionTokenSecret: string;
  }): Promise<{ id: string; ticketTypeName: string; orderReference: string; holderName: string; holderEmail: string; status: string; checkedIn: boolean; admissionCredential: string; event: { id: string; title: string; slug: string; startAt: Date; endAt: Date; venue: string; address: string; timeZone: string } } | null>;
  getCustomerTicketDocument(input: {
    database: ReturnType<typeof createDatabaseClient>;
    customerProfileId: string;
    ticketId: string;
  }): Promise<{ status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' } | null>;
  getCustomerTicketDownload(input: {
    database: ReturnType<typeof createDatabaseClient>;
    customerProfileId: string;
    ticketId: string;
    createDownloadUrl: (objectKey: string) => Promise<string>;
  }): Promise<{ url: string } | null>;
  requestOrderConfirmationResend(input: {
    database: ReturnType<typeof createDatabaseClient>;
    customerProfileId: string;
    orderReference: string;
    idempotencyKey?: string;
  }): Promise<{ id: string } | null>;
};

async function loadCustomerTicketAccess(): Promise<CustomerTicketAccess | undefined> {
  try {
    const module = await import('../src/customer/customer-ticket-access.js');
    return {
      listCustomerOrders: module.listCustomerOrders,
      listCustomerTickets: module.listCustomerTickets,
      getCustomerTicket: module.getCustomerTicket,
      getCustomerTicketDocument: module.getCustomerTicketDocument,
      getCustomerTicketDownload: module.getCustomerTicketDownload,
      requestOrderConfirmationResend: module.requestOrderConfirmationResend,
    };
  } catch {
    return undefined;
  }
}

describe('customer ticket access', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      await client.$executeRaw`DELETE FROM notification_job WHERE "orderId" IN (${ids.customerOneOrderId ?? ''}, ${ids.customerOnePendingOrderId ?? ''}, ${ids.customerTwoOrderId ?? ''})`;
      await client.$executeRaw`DELETE FROM ticket_document_job WHERE "ticketId" IN (${ids.customerOneTicketId ?? ''}, ${ids.customerTwoTicketId ?? ''})`;
      await client.$executeRaw`DELETE FROM ticket WHERE id IN (${ids.customerOneTicketId ?? ''}, ${ids.customerTwoTicketId ?? ''})`;
      await client.$executeRaw`DELETE FROM "order" WHERE id IN (${ids.customerOneOrderId ?? ''}, ${ids.customerOnePendingOrderId ?? ''}, ${ids.customerTwoOrderId ?? ''})`;
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.ticketTypeId) await client.$executeRaw`DELETE FROM ticket_type WHERE id = ${ids.ticketTypeId}`;
      if (ids.eventId) await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      for (const userId of [ids.organizerUserId, ids.customerOneUserId, ids.customerTwoUserId]) {
        if (userId) await client.$executeRaw`DELETE FROM auth_user WHERE id = ${userId}`;
      }
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('lists the authenticated customer’s paginated order history and filters by status', async () => {
    const customerTicketAccess = await loadCustomerTicketAccess();
    const databaseUrl = process.env.DATABASE_URL;
    expect(customerTicketAccess).toBeDefined();
    if (!customerTicketAccess || !databaseUrl) throw new Error('customer ticket access is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await expect(customerTicketAccess.listCustomerOrders({ database: client, customerProfileId: ids.customerOneProfileId, page: 1, pageSize: 1 })).resolves.toEqual({
      items: [{ reference: 'customer-one-pending-order', status: 'PENDING_PAYMENT', tickets: [] }],
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    await expect(customerTicketAccess.listCustomerOrders({ database: client, customerProfileId: ids.customerOneProfileId, status: 'PAID', page: 1, pageSize: 20 })).resolves.toEqual({
      items: [{ reference: 'customer-one-order', status: 'PAID', tickets: [{ id: ids.customerOneTicketId, ticketTypeName: 'General admission' }] }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('returns a rich admission-ready ticket only to its owning customer', async () => {
    const customerTicketAccess = await loadCustomerTicketAccess();
    const databaseUrl = process.env.DATABASE_URL;
    expect(customerTicketAccess).toBeDefined();
    if (!customerTicketAccess || !databaseUrl) throw new Error('customer ticket access is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await expect(
      customerTicketAccess.getCustomerTicket({
        database: client,
        customerProfileId: ids.customerOneProfileId,
        ticketId: ids.customerTwoTicketId,
        admissionTokenSecret: 'ticket-contract-secret-that-is-long-enough',
      }),
    ).resolves.toBeNull();
    await expect(
      customerTicketAccess.getCustomerTicket({
        database: client,
        customerProfileId: ids.customerOneProfileId,
        ticketId: ids.customerOneTicketId,
        admissionTokenSecret: 'ticket-contract-secret-that-is-long-enough',
      }),
    ).resolves.toEqual({
      id: ids.customerOneTicketId,
      ticketTypeName: 'General admission',
      orderReference: 'customer-one-order',
      holderName: 'Customer one',
      holderEmail: `${ids.customerOneTicketId}@example.test`,
      status: 'ACTIVE',
      checkedIn: false,
      admissionCredential: 'et1.ticket-contract-id.AmP3tpgNmLyo908KwtavnwRbzKuAtIB0hmMqJPhjd-A',
      event: {
        id: ids.eventId,
        title: 'Customer event',
        slug: `customer-event-${ids.eventId}`,
        startAt: new Date('2032-02-01T10:00:00.000Z'),
        endAt: new Date('2032-02-01T12:00:00.000Z'),
        venue: 'Venue',
        address: 'Address',
        timeZone: 'Africa/Lagos',
      },
    });
    await expect(customerTicketAccess.listCustomerTickets({ database: client, customerProfileId: ids.customerOneProfileId, admissionTokenSecret: 'ticket-contract-secret-that-is-long-enough' })).resolves.toEqual([
      expect.objectContaining({ id: ids.customerOneTicketId, admissionCredential: 'et1.ticket-contract-id.AmP3tpgNmLyo908KwtavnwRbzKuAtIB0hmMqJPhjd-A' }),
    ]);
    await expect(
      customerTicketAccess.getCustomerTicketDocument({
        database: client,
        customerProfileId: ids.customerOneProfileId,
        ticketId: ids.customerOneTicketId,
      }),
    ).resolves.toEqual({ status: 'PENDING' });
    await expect(
      customerTicketAccess.getCustomerTicketDocument({
        database: client,
        customerProfileId: ids.customerTwoProfileId,
        ticketId: ids.customerOneTicketId,
      }),
    ).resolves.toBeNull();
  });

  it('creates a short-lived private download URL only for the owning customer after PDF generation', async () => {
    const customerTicketAccess = await loadCustomerTicketAccess();
    const databaseUrl = process.env.DATABASE_URL;
    expect(customerTicketAccess).toBeDefined();
    if (!customerTicketAccess || !databaseUrl) throw new Error('customer ticket access is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    await client.ticketDocumentJob.update({ where: { ticketId: ids.customerOneTicketId }, data: { status: 'READY' } });

    await expect(customerTicketAccess.getCustomerTicketDownload({
      database: client,
      customerProfileId: ids.customerOneProfileId,
      ticketId: ids.customerOneTicketId,
      createDownloadUrl: async (objectKey) => `https://r2.example.test/${objectKey}?expires=300`,
    })).resolves.toEqual({ url: `https://r2.example.test/tickets/${ids.customerOneTicketId}.pdf?expires=300` });
    await expect(customerTicketAccess.getCustomerTicketDownload({
      database: client,
      customerProfileId: ids.customerTwoProfileId,
      ticketId: ids.customerOneTicketId,
      createDownloadUrl: async () => 'https://unsafe.example.test',
    })).resolves.toBeNull();
  });

  it('queues a customer-owned confirmation resend without issuing another ticket', async () => {
    const customerTicketAccess = await loadCustomerTicketAccess();
    const databaseUrl = process.env.DATABASE_URL;
    expect(customerTicketAccess).toBeDefined();
    if (!customerTicketAccess || !databaseUrl) throw new Error('customer ticket access is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await expect(customerTicketAccess.requestOrderConfirmationResend({
      database: client,
      customerProfileId: ids.customerOneProfileId,
      orderReference: 'customer-one-order',
      idempotencyKey: 'resend-confirmation-1',
    })).resolves.toEqual({ id: expect.any(String) });
    await expect(client.notificationJob.findUnique({ where: { idempotencyKey: 'resend-confirmation-1' }, select: { orderId: true, recipientEmail: true, type: true, status: true } })).resolves.toEqual({
      orderId: ids.customerOneOrderId,
      recipientEmail: `${ids.customerOneOrderId}@example.test`,
      type: 'ORDER_CONFIRMATION',
      status: 'PENDING',
    });
    await expect(client.ticket.count({ where: { orderId: ids.customerOneOrderId } })).resolves.toBe(1);
    await expect(customerTicketAccess.requestOrderConfirmationResend({
      database: client,
      customerProfileId: ids.customerTwoProfileId,
      orderReference: 'customer-one-order',
      idempotencyKey: 'resend-confirmation-2',
    })).resolves.toBeNull();
    await expect(client.notificationJob.count({ where: { idempotencyKey: 'resend-confirmation-2' } })).resolves.toBe(0);
  });
});

async function createFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, {
    organizerUserId: randomUUID(), organizerProfileId: randomUUID(), customerOneUserId: randomUUID(),
    customerOneProfileId: randomUUID(), customerTwoUserId: randomUUID(), customerTwoProfileId: randomUUID(),
    categoryId: randomUUID(), eventId: randomUUID(), ticketTypeId: randomUUID(), feeRuleId: randomUUID(),
    customerOneOrderId: randomUUID(), customerOnePendingOrderId: randomUUID(), customerTwoOrderId: randomUUID(), customerOneTicketId: 'ticket-contract-id', customerTwoTicketId: randomUUID(),
  });
  for (const [userId, name] of [[ids.organizerUserId, 'Organizer'], [ids.customerOneUserId, 'Customer one'], [ids.customerTwoUserId, 'Customer two']] as const) {
    await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${userId}, ${name}, ${`${userId}@example.test`}, true, NOW(), NOW())`;
  }
  for (const [profileId, userId, role] of [[ids.organizerProfileId, ids.organizerUserId, 'ORGANIZER'], [ids.customerOneProfileId, ids.customerOneUserId, 'CUSTOMER'], [ids.customerTwoProfileId, ids.customerTwoUserId, 'CUSTOMER']] as const) {
    await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${profileId}, ${userId}, ${role}, 'ACTIVE', NOW(), NOW())`;
  }
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, ${`Customer ${ids.categoryId}`}, ${`customer-${ids.categoryId}`}, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, ${ids.organizerProfileId}, ${ids.categoryId}, 'Customer event', ${`customer-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-02-01T10:00:00.000Z', '2032-02-01T12:00:00.000Z', 'PUBLISHED', '2032-01-01T10:00:00.000Z', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'General admission', 1000, 20, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.feeRuleId}, ${Number(`7${Date.now().toString().slice(-6)}`)}, 'FIXED', 0, '2030-01-01T00:00:00.000Z', NOW())`;
  for (const [orderId, profileId, reference, buyerName] of [[ids.customerOneOrderId, ids.customerOneProfileId, 'customer-one-order', 'Customer one'], [ids.customerTwoOrderId, ids.customerTwoProfileId, 'customer-two-order', 'Customer two']] as const) {
    await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "customerProfileId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "paidAt", "createdAt") VALUES (${orderId}, ${reference}, ${ids.eventId}, ${profileId}, ${buyerName}, ${`${orderId}@example.test`}, 'NGN', 1000, 0, 1000, ${ids.feeRuleId}, 1, 'FIXED', 0, '2032-01-01T10:10:00.000Z', 'PAID', '2032-01-01T10:01:00.000Z', NOW())`;
  }
  await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "customerProfileId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "createdAt") VALUES (${ids.customerOnePendingOrderId}, 'customer-one-pending-order', ${ids.eventId}, ${ids.customerOneProfileId}, 'Customer one', ${`${ids.customerOnePendingOrderId}@example.test`}, 'NGN', 1000, 0, 1000, ${ids.feeRuleId}, 1, 'FIXED', 0, '2032-01-01T10:10:00.000Z', 'PENDING_PAYMENT', '2032-01-01T10:02:00.000Z')`;
  for (const [ticketId, orderId, name] of [[ids.customerOneTicketId, ids.customerOneOrderId, 'Customer one'], [ids.customerTwoTicketId, ids.customerTwoOrderId, 'Customer two']] as const) {
    const digest = ticketId === ids.customerOneTicketId ? 'ticket-contract-digest' : `digest-${ticketId}`;
    await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ticketId}, ${orderId}, ${ids.eventId}, ${ids.ticketTypeId}, ${name}, ${`${ticketId}@example.test`}, 'General admission', 1000, ${digest}, NOW())`;
  }
  await client.$executeRaw`INSERT INTO ticket_document_job (id, "ticketId", "objectKey", status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${ids.customerOneTicketId}, ${`tickets/${ids.customerOneTicketId}.pdf`}, 'PENDING', NOW(), NOW())`;
}
