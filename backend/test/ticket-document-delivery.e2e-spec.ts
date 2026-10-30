import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type TicketDocumentDelivery = {
  processPendingTicketDocuments(input: {
    database: ReturnType<typeof createDatabaseClient>;
    objectStore: { putPrivatePdf(input: { objectKey: string; pdf: Uint8Array }): Promise<void> };
    ticketCredentialSecret: string;
    now: Date;
  }): Promise<{ generated: number; failed: number }>;
};

async function loadTicketDocumentDelivery(): Promise<TicketDocumentDelivery | undefined> {
  try {
    return await import('../src/worker/ticket-document-delivery.js') as TicketDocumentDelivery;
  } catch {
    return undefined;
  }
}

describe('ticket PDF delivery worker', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.documentJobId) await client.ticketDocumentJob.deleteMany({ where: { id: ids.documentJobId } });
      if (ids.ticketId) await client.ticket.deleteMany({ where: { id: ids.ticketId } });
      if (ids.orderId) await client.order.deleteMany({ where: { id: ids.orderId } });
      if (ids.feeRuleId) await client.platformFeeRule.deleteMany({ where: { id: ids.feeRuleId } });
      if (ids.ticketTypeId) await client.ticketType.deleteMany({ where: { id: ids.ticketTypeId } });
      if (ids.eventId) await client.event.deleteMany({ where: { id: ids.eventId } });
      if (ids.categoryId) await client.eventCategory.deleteMany({ where: { id: ids.categoryId } });
      if (ids.userId) await client.auth_user.deleteMany({ where: { id: ids.userId } });
      await client.$disconnect();
    }
    client = undefined;
    Object.keys(ids).forEach((key) => delete ids[key]);
  });

  it('creates a private PDF containing a signed scannable credential and marks the durable job ready', async () => {
    const delivery = await loadTicketDocumentDelivery();
    const databaseUrl = process.env.DATABASE_URL;
    expect(delivery).toBeDefined();
    if (!delivery || !databaseUrl) throw new Error('ticket PDF delivery is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const uploads: Array<{ objectKey: string; pdf: Uint8Array }> = [];

    await expect(delivery.processPendingTicketDocuments({
      database: client,
      objectStore: { putPrivatePdf: async (input) => { uploads.push(input); } },
      ticketCredentialSecret: 'ticket-credential-secret-that-is-long-enough',
      now: new Date('2032-01-01T10:00:00.000Z'),
    })).resolves.toEqual({ generated: 1, failed: 0 });

    expect(uploads).toHaveLength(1);
    expect(uploads[0].objectKey).toBe(`tickets/${ids.ticketId}.pdf`);
    expect(Buffer.from(uploads[0].pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect(firstPdfContentStream(uploads[0].pdf)).toContain(Buffer.from(`Ticket code: ${ids.ticketId}`).toString('hex').toUpperCase());
    await expect(client.ticketDocumentJob.findUnique({ where: { id: ids.documentJobId }, select: { status: true, failureDetail: true } })).resolves.toEqual({ status: 'READY', failureDetail: null });
  });
});

function firstPdfContentStream(pdf: Uint8Array): string {
  const bytes = Buffer.from(pdf);
  const streamStart = bytes.indexOf(Buffer.from('stream\n')) + 'stream\n'.length;
  const streamEnd = bytes.indexOf(Buffer.from('\nendstream'), streamStart);
  return inflateSync(bytes.subarray(streamStart, streamEnd)).toString('latin1');
}

async function createFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, {
    userId: randomUUID(), profileId: randomUUID(), categoryId: randomUUID(), eventId: randomUUID(), ticketTypeId: randomUUID(), feeRuleId: randomUUID(), orderId: randomUUID(), ticketId: randomUUID(), documentJobId: randomUUID(),
  });
  await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${ids.userId}, 'Organizer', ${`${ids.userId}@example.test`}, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${ids.profileId}, ${ids.userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, ${`Category ${ids.categoryId}`}, ${`category-${ids.categoryId}`}, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, ${ids.profileId}, ${ids.categoryId}, 'PDF Event', ${`pdf-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-02-01T10:00:00.000Z', '2032-02-01T12:00:00.000Z', 'PUBLISHED', NOW(), NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'General', 2000, 10, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "activeUntil", "createdAt") VALUES (${ids.feeRuleId}, ${Number(`9${Date.now().toString().slice(-8)}`)}, 'FIXED', 0, '2029-01-01T00:00:00.000Z', '2029-12-31T00:00:00.000Z', NOW())`;
  await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "paidAt", "createdAt") VALUES (${ids.orderId}, ${`pdf-order-${ids.orderId}`}, ${ids.eventId}, 'Buyer', 'buyer@example.test', 'NGN', 2000, 0, 2000, ${ids.feeRuleId}, 1, 'FIXED', 0, '2032-01-01T10:10:00.000Z', 'PAID', '2032-01-01T10:00:00.000Z', NOW())`;
  await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ids.ticketId}, ${ids.orderId}, ${ids.eventId}, ${ids.ticketTypeId}, 'Buyer', 'buyer@example.test', 'General', 2000, ${'a'.repeat(64)}, NOW())`;
  await client.$executeRaw`INSERT INTO ticket_document_job (id, "ticketId", "objectKey", status, "createdAt", "updatedAt") VALUES (${ids.documentJobId}, ${ids.ticketId}, ${`tickets/${ids.ticketId}.pdf`}, 'PENDING', NOW(), NOW())`;
}
