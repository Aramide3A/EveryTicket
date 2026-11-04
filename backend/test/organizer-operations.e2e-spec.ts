import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type OrganizerOperations = {
  getOrganizerDashboard(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
    now: Date;
  }): Promise<{
    confirmedTicketsSold: number;
    remainingCapacity: number;
    ticketSubtotalKobo: number;
    platformFeeKobo: number;
    totalPaidKobo: number;
    refundsRecordedKobo: number;
    payableKobo: number;
    payoutEligible: boolean;
    ticketCheckIns: number;
    guestCheckIns: number;
    salesByTicketType: Array<{ ticketTypeId: string; name: string; quantity: number; ticketSubtotalKobo: number }>;
    salesTrend: Array<{ date: string; ticketSubtotalKobo: number; totalPaidKobo: number }>;
  }>;
  listOrganizerAttendees(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
  }): Promise<Array<{ kind: 'TICKET' | 'GUEST'; attendeeId: string; name: string; email: string; ticketTypeName: string | null; responseStatus: string | null; credentialStatus: string; checkedIn: boolean }>>;
  exportOrganizerAttendeesCsv(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
  }): Promise<string>;
  listOrganizerCheckIns(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string }): Promise<Array<{ id: string; kind: 'TICKET' | 'GUEST'; attendeeId: string; name: string; checkedInAt: Date; checkedInBy: { id: string; name: string } }>>;
  exportOrganizerCheckInsCsv(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string }): Promise<string>;
  createRefundRequest(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    orderId: string;
    ticketIds: string[];
    ticketRefundKobo: number;
    platformFeeRefundKobo: number;
    reason: string;
    now: Date;
  }): Promise<{ id: string; status: 'REQUESTED'; totalRefundKobo: number }>;
  createPayoutRequest(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
    now: Date;
  }): Promise<{ id: string; status: 'REQUESTED'; requestedAmountKobo: number; calculatedPayableKobo: number }>;
  listOrganizerRefundRequests(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string }): Promise<Array<{ id: string; totalRefundKobo: number; status: string }>>;
  listOrganizerPayoutRequests(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string }): Promise<Array<{ id: string; requestedAmountKobo: number; status: string }>>;
  getOrganizerPayoutRequest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; payoutRequestId: string }): Promise<{ id: string; event: { id: string; title: string }; status: string; requestedAmountKobo: number; calculatedPayableKobo: number; requestedAt: Date; reviewReason: string | null; transferReference: string | null; transferDate: Date | null; paidAt: Date | null; receiptAvailable: boolean }>;
  exportOrganizerPayoutReceiptCsv(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; payoutRequestId: string }): Promise<string>;
  listOrganizerOrders(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string }): Promise<Array<{ id: string; reference: string; totalKobo: number; status: string }>>;
  pageOrganizerOrders(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; page: number; pageSize: number; skip: number; query?: string; status?: string }): Promise<{ items: Array<{ id: string; status: string }>; page: number; pageSize: number; total: number }>;
  pageOrganizerAttendees(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; page: number; pageSize: number; skip: number; query?: string; kind?: 'TICKET' | 'GUEST' }): Promise<{ items: Array<{ kind: string; name: string }>; page: number; pageSize: number; total: number }>;
  pageOrganizerRefundRequests(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; page: number; pageSize: number; skip: number; status?: string }): Promise<{ items: Array<{ id: string; status: string }>; page: number; pageSize: number; total: number }>;
  pageOrganizerPayoutRequests(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; page: number; pageSize: number; skip: number; status?: string }): Promise<{ items: Array<{ id: string; status: string }>; page: number; pageSize: number; total: number }>;
  getOrganizerOrderRefundInputs(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; orderId: string }): Promise<{ id: string; reference: string; buyerName: string; buyerEmail: string; status: string; maxPlatformFeeRefundKobo: number; tickets: Array<{ id: string; holderName: string; holderEmail: string; ticketTypeName: string; priceKobo: number; eligible: boolean; maxTicketRefundKobo: number }> }>;
  updateRefundRequest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; refundRequestId: string; ticketRefundKobo: number; platformFeeRefundKobo: number; reason: string }): Promise<{ totalRefundKobo: number }>;
  cancelRefundRequest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; refundRequestId: string }): Promise<void>;
  getOrganizerRefundRequest(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; refundRequestId: string }): Promise<{ id: string; orderId: string; reason: string; status: string; ticketRefundKobo: number; platformFeeRefundKobo: number; totalRefundKobo: number; maxTicketRefundKobo: number; maxPlatformFeeRefundKobo: number; permittedActions: Array<'UPDATE' | 'CANCEL'>; tickets: Array<{ id: string; holderName: string; ticketTypeName: string; priceKobo: number }> }>;
};

async function loadOrganizerOperations(): Promise<OrganizerOperations | undefined> {
  try {
    return await import('../src/organizer/organizer-operations.js') as OrganizerOperations;
  } catch {
    return undefined;
  }
}

describe('organizer operations', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.eventId || ids.otherEventId) {
        await client.$executeRaw`DELETE FROM check_in WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM refund_request_ticket WHERE "refundRequestId" IN (SELECT id FROM refund_request WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''}))`;
        await client.$executeRaw`DELETE FROM refund_request WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM payout_request WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM guest WHERE "guestListId" IN (SELECT id FROM guest_list WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''}))`;
        await client.$executeRaw`DELETE FROM guest_list WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM ticket WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM "order" WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM ticket_type WHERE "eventId" IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
        await client.$executeRaw`DELETE FROM event WHERE id IN (${ids.eventId ?? ''}, ${ids.otherEventId ?? ''})`;
      }
      if (ids.feeRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}`;
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      for (const userId of [ids.organizerUserId, ids.otherOrganizerUserId].filter(Boolean)) {
        await client.$executeRaw`DELETE FROM auth_user WHERE id = ${userId}`;
      }
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('returns only an owner-scoped event dashboard with confirmed sales and attendance', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);

    await expect(operations.getOrganizerDashboard({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, now: new Date('2031-01-01T00:00:00.000Z') })).resolves.toEqual({
      confirmedTicketsSold: 1,
      remainingCapacity: 9,
      ticketSubtotalKobo: 2000,
      platformFeeKobo: 200,
      totalPaidKobo: 2200,
      refundsRecordedKobo: 0,
      payableKobo: 2000,
      payoutEligible: false,
      ticketCheckIns: 1,
      guestCheckIns: 1,
      salesByTicketType: [{ ticketTypeId: ids.ticketTypeId, name: 'General', quantity: 1, ticketSubtotalKobo: 2000 }],
      salesTrend: [{ date: '2031-12-01', ticketSubtotalKobo: 2000, totalPaidKobo: 2200 }],
    });
    await expect(operations.getOrganizerDashboard({ database: client, organizerProfileId: ids.otherOrganizerProfileId, eventId: ids.eventId, now: new Date('2031-01-01T00:00:00.000Z') })).rejects.toThrow('event is unavailable to this organizer');
    await expect(operations.listOrganizerOrders({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId })).resolves.toEqual([
      expect.objectContaining({ id: ids.orderId, totalKobo: 2200, status: 'PAID' }),
    ]);
    await expect(operations.pageOrganizerOrders({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, page: 1, pageSize: 10, skip: 0, query: 'no-match', status: 'PAID' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(operations.pageOrganizerOrders({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, page: 1, pageSize: 10, skip: 0, status: 'CANCELLED' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(operations.listOrganizerOrders({ database: client, organizerProfileId: ids.otherOrganizerProfileId, eventId: ids.eventId })).rejects.toThrow('event is unavailable to this organizer');
  });

  it('lists only the owner event attendees and escapes CSV formulas', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);

    await expect(operations.listOrganizerAttendees({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId })).resolves.toEqual([
      { kind: 'TICKET', attendeeId: ids.ticketId, name: '=Attendee', email: `${ids.ticketId}@example.test`, ticketTypeName: 'General', responseStatus: null, credentialStatus: 'ACTIVE', checkedIn: true },
      { kind: 'GUEST', attendeeId: ids.guestId, name: 'Guest attendee', email: 'guest@example.test', ticketTypeName: null, responseStatus: 'ACCEPTED', credentialStatus: 'ACTIVE', checkedIn: true },
    ]);
    await expect(operations.exportOrganizerAttendeesCsv({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId })).resolves.toContain(
      `TICKET,'=Attendee,${ids.ticketId}@example.test,General,,ACTIVE,checked-in`,
    );
    await expect(operations.listOrganizerAttendees({ database: client, organizerProfileId: ids.otherOrganizerProfileId, eventId: ids.eventId })).rejects.toThrow('event is unavailable to this organizer');
    await expect(operations.pageOrganizerAttendees({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, page: 1, pageSize: 10, skip: 0, query: 'guest attendee', kind: 'GUEST' })).resolves.toEqual(expect.objectContaining({ items: [expect.objectContaining({ kind: 'GUEST', name: 'Guest attendee' })], total: 1 }));
  });

  it('returns and exports owner-scoped ticket and guest check-in history', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);

    const history = await operations.listOrganizerCheckIns({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId });
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'TICKET', attendeeId: ids.ticketId, name: '=Attendee', checkedInBy: { id: ids.organizerProfileId, name: 'Owner' } }),
      expect.objectContaining({ kind: 'GUEST', attendeeId: ids.guestId, name: 'Guest attendee', checkedInBy: { id: ids.organizerProfileId, name: 'Owner' } }),
    ]));
    await expect(operations.exportOrganizerCheckInsCsv({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId })).resolves.toContain("TICKET,'=Attendee,");
    await expect(operations.listOrganizerCheckIns({ database: client, organizerProfileId: ids.otherOrganizerProfileId, eventId: ids.eventId })).rejects.toThrow('event is unavailable to this organizer');
  });

  it('records an owner refund request only for selected paid-order tickets', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);

    const refund = await operations.createRefundRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      orderId: ids.orderId,
      ticketIds: [ids.ticketId],
      ticketRefundKobo: 1500,
      platformFeeRefundKobo: 100,
      reason: 'Event timing changed',
      now: new Date('2031-12-02T10:00:00.000Z'),
    });
    expect(refund).toMatchObject({ id: expect.any(String), status: 'REQUESTED', totalRefundKobo: 1600 });
    await expect(operations.getOrganizerRefundRequest({ database: client, organizerProfileId: ids.organizerProfileId, refundRequestId: refund.id })).resolves.toEqual({
      id: refund.id,
      orderId: ids.orderId,
      reason: 'Event timing changed',
      status: 'REQUESTED',
      ticketRefundKobo: 1500,
      platformFeeRefundKobo: 100,
      totalRefundKobo: 1600,
      maxTicketRefundKobo: 2000,
      maxPlatformFeeRefundKobo: 200,
      permittedActions: ['UPDATE', 'CANCEL'],
      tickets: [{ id: ids.ticketId, holderName: '=Attendee', ticketTypeName: 'General', priceKobo: 2000 }],
    });
    await expect(operations.getOrganizerRefundRequest({ database: client, organizerProfileId: ids.otherOrganizerProfileId, refundRequestId: refund.id })).rejects.toThrow('refund request is unavailable to this organizer');
    await expect(operations.listOrganizerRefundRequests({ database: client, organizerProfileId: ids.organizerProfileId })).resolves.toEqual([
      expect.objectContaining({ id: refund.id, totalRefundKobo: 1600, status: 'REQUESTED' }),
    ]);
    await expect(operations.pageOrganizerRefundRequests({ database: client, organizerProfileId: ids.organizerProfileId, page: 1, pageSize: 10, skip: 0, status: 'CANCELLED' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(operations.getOrganizerDashboard({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, now: new Date('2031-12-02T10:00:00.000Z') })).resolves.toMatchObject({
      refundsRecordedKobo: 1600,
      payableKobo: 500,
    });
    await expect(operations.createRefundRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      orderId: ids.orderId,
      ticketIds: [ids.ticketId],
      ticketRefundKobo: 100,
      platformFeeRefundKobo: 0,
      reason: 'Duplicate ticket refund',
      now: new Date('2031-12-02T10:00:00.000Z'),
    })).rejects.toThrow('a refund already reserves a selected ticket');
    await expect(operations.createRefundRequest({
      database: client,
      organizerProfileId: ids.otherOrganizerProfileId,
      orderId: ids.orderId,
      ticketIds: [ids.ticketId],
      ticketRefundKobo: 1500,
      platformFeeRefundKobo: 100,
      reason: 'Unauthorized request',
      now: new Date('2031-12-02T10:00:00.000Z'),
    })).rejects.toThrow('order is unavailable to this organizer');
    await expect(operations.updateRefundRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      refundRequestId: refund.id,
      ticketRefundKobo: 1200,
      platformFeeRefundKobo: 50,
      reason: 'Updated event timing',
    })).resolves.toEqual({ totalRefundKobo: 1250 });
    await operations.cancelRefundRequest({ database: client, organizerProfileId: ids.organizerProfileId, refundRequestId: refund.id });
    await expect(operations.getOrganizerDashboard({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, now: new Date('2031-12-03T10:00:00.000Z') })).resolves.toMatchObject({
      refundsRecordedKobo: 0,
      payableKobo: 2000,
    });
    await expect(operations.updateRefundRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      refundRequestId: refund.id,
      ticketRefundKobo: 100,
      platformFeeRefundKobo: 0,
      reason: 'Too late',
    })).rejects.toThrow('refund request is unavailable to this organizer');
  });

  it('exposes owner-scoped refund inputs and remaining amount limits', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);

    await expect(operations.getOrganizerOrderRefundInputs({ database: client, organizerProfileId: ids.organizerProfileId, orderId: ids.orderId })).resolves.toEqual({
      id: ids.orderId,
      reference: `dashboard-${ids.orderId}`,
      buyerName: 'Buyer',
      buyerEmail: `${ids.orderId}@example.test`,
      status: 'PAID',
      maxPlatformFeeRefundKobo: 200,
      tickets: [{ id: ids.ticketId, holderName: '=Attendee', holderEmail: `${ids.ticketId}@example.test`, ticketTypeName: 'General', priceKobo: 2000, eligible: true, maxTicketRefundKobo: 2000 }],
    });
    await operations.createRefundRequest({ database: client, organizerProfileId: ids.organizerProfileId, orderId: ids.orderId, ticketIds: [ids.ticketId], ticketRefundKobo: 1500, platformFeeRefundKobo: 100, reason: 'Partial refund', now: new Date() });
    await expect(operations.getOrganizerOrderRefundInputs({ database: client, organizerProfileId: ids.organizerProfileId, orderId: ids.orderId })).resolves.toEqual(expect.objectContaining({
      maxPlatformFeeRefundKobo: 100,
      tickets: [expect.objectContaining({ id: ids.ticketId, eligible: false, maxTicketRefundKobo: 0 })],
    }));
    await expect(operations.getOrganizerOrderRefundInputs({ database: client, organizerProfileId: ids.otherOrganizerProfileId, orderId: ids.orderId })).rejects.toThrow('order is unavailable to this organizer');
  });

  it('calculates one post-event payout from paid ticket subtotals and reserves it', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);

    await expect(operations.createPayoutRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      eventId: ids.eventId,
      now: new Date('2031-01-01T00:00:00.000Z'),
    })).rejects.toThrow('payout is unavailable before the event ends');

    const payout = await operations.createPayoutRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      eventId: ids.eventId,
      now: new Date('2033-01-01T00:00:00.000Z'),
    });
    expect(payout).toMatchObject({ id: expect.any(String), status: 'REQUESTED', requestedAmountKobo: 2000, calculatedPayableKobo: 2000 });
    await expect(operations.listOrganizerPayoutRequests({ database: client, organizerProfileId: ids.organizerProfileId })).resolves.toEqual([
      expect.objectContaining({ id: payout.id, requestedAmountKobo: 2000, status: 'REQUESTED' }),
    ]);
    await expect(operations.pageOrganizerPayoutRequests({ database: client, organizerProfileId: ids.organizerProfileId, page: 1, pageSize: 10, skip: 0, status: 'PAID' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(operations.getOrganizerPayoutRequest({ database: client, organizerProfileId: ids.organizerProfileId, payoutRequestId: payout.id })).resolves.toEqual(expect.objectContaining({ id: payout.id, status: 'REQUESTED', receiptAvailable: false, transferReference: null }));
    await expect(operations.exportOrganizerPayoutReceiptCsv({ database: client, organizerProfileId: ids.organizerProfileId, payoutRequestId: payout.id })).rejects.toThrow('payout receipt is unavailable');
    await client.payoutRequest.update({ where: { id: payout.id }, data: { status: 'PAID', transferReference: '=TRF_123', transferDate: new Date('2033-01-02T10:00:00.000Z'), paidAt: new Date('2033-01-02T11:00:00.000Z') } });
    await expect(operations.getOrganizerPayoutRequest({ database: client, organizerProfileId: ids.organizerProfileId, payoutRequestId: payout.id })).resolves.toEqual(expect.objectContaining({ id: payout.id, status: 'PAID', receiptAvailable: true, transferReference: '=TRF_123' }));
    await expect(operations.exportOrganizerPayoutReceiptCsv({ database: client, organizerProfileId: ids.organizerProfileId, payoutRequestId: payout.id })).resolves.toContain("'=TRF_123");
    await expect(operations.getOrganizerPayoutRequest({ database: client, organizerProfileId: ids.otherOrganizerProfileId, payoutRequestId: payout.id })).rejects.toThrow('payout request is unavailable to this organizer');
    await expect(operations.createPayoutRequest({
      database: client,
      organizerProfileId: ids.organizerProfileId,
      eventId: ids.eventId,
      now: new Date('2033-01-01T00:00:00.000Z'),
    })).rejects.toThrow('no payout is available for this event');
    await expect(operations.createPayoutRequest({
      database: client,
      organizerProfileId: ids.otherOrganizerProfileId,
      eventId: ids.eventId,
      now: new Date('2033-01-01T00:00:00.000Z'),
    })).rejects.toThrow('event is unavailable to this organizer');
  });

  it('allows exactly one concurrent payout request for the same event revenue', async () => {
    const operations = await loadOrganizerOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(operations).toBeDefined();
    if (!operations || !databaseUrl) throw new Error('organizer operations are unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createDashboardFixture(client, ids);
    const results = await Promise.allSettled([
      operations.createPayoutRequest({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, now: new Date('2033-01-01T00:00:00.000Z') }),
      operations.createPayoutRequest({ database: client, organizerProfileId: ids.organizerProfileId, eventId: ids.eventId, now: new Date('2033-01-01T00:00:00.000Z') }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await client.payoutRequest.count({ where: { eventId: ids.eventId } })).toBe(1);
  });
});

async function createDashboardFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, {
    organizerUserId: randomUUID(), organizerProfileId: randomUUID(), otherOrganizerUserId: randomUUID(), otherOrganizerProfileId: randomUUID(),
    categoryId: randomUUID(), eventId: randomUUID(), otherEventId: randomUUID(), ticketTypeId: randomUUID(), otherTicketTypeId: randomUUID(),
    feeRuleId: randomUUID(), orderId: randomUUID(), otherOrderId: randomUUID(), ticketId: randomUUID(), otherTicketId: randomUUID(), guestListId: randomUUID(), guestId: randomUUID(),
  });
  for (const [userId, profileId, name] of [[ids.organizerUserId, ids.organizerProfileId, 'Owner'], [ids.otherOrganizerUserId, ids.otherOrganizerProfileId, 'Other owner']] as const) {
    await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${userId}, ${name}, ${`${userId}@example.test`}, true, NOW(), NOW())`;
    await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${profileId}, ${userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  }
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, 'Organizer dashboard', ${`organizer-dashboard-${ids.categoryId}`}, NOW(), NOW())`;
  for (const [eventId, organizerProfileId, slug] of [[ids.eventId, ids.organizerProfileId, `dashboard-${ids.eventId}`], [ids.otherEventId, ids.otherOrganizerProfileId, `dashboard-${ids.otherEventId}`]] as const) {
    await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${eventId}, ${organizerProfileId}, ${ids.categoryId}, 'Dashboard event', ${slug}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-01-02T10:00:00.000Z', '2032-01-02T12:00:00.000Z', 'PUBLISHED', '2031-12-01T10:00:00.000Z', NOW(), NOW())`;
  }
  for (const [ticketTypeId, eventId] of [[ids.ticketTypeId, ids.eventId], [ids.otherTicketTypeId, ids.otherEventId]] as const) {
    await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ticketTypeId}, ${eventId}, 'General', 2000, 10, true, NOW(), NOW())`;
  }
  await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.feeRuleId}, ${Number(`7${Date.now().toString().slice(-6)}`)}, 'FIXED', 200, '2030-01-01T00:00:00.000Z', NOW())`;
  for (const [orderId, eventId, reference] of [[ids.orderId, ids.eventId, `dashboard-${ids.orderId}`], [ids.otherOrderId, ids.otherEventId, `dashboard-${ids.otherOrderId}`]] as const) {
    await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "paidAt", "createdAt") VALUES (${orderId}, ${reference}, ${eventId}, 'Buyer', ${`${orderId}@example.test`}, 'NGN', 2000, 200, 2200, ${ids.feeRuleId}, 1, 'FIXED', 200, '2032-01-01T10:10:00.000Z', 'PAID', '2031-12-01T10:01:00.000Z', NOW())`;
  }
  for (const [ticketId, orderId, eventId, ticketTypeId] of [[ids.ticketId, ids.orderId, ids.eventId, ids.ticketTypeId], [ids.otherTicketId, ids.otherOrderId, ids.otherEventId, ids.otherTicketTypeId]] as const) {
    await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ticketId}, ${orderId}, ${eventId}, ${ticketTypeId}, '=Attendee', ${`${ticketId}@example.test`}, 'General', 2000, ${`digest-${ticketId}`}, NOW())`;
  }
  await client.$executeRaw`INSERT INTO guest_list (id, "eventId", name, "createdAt", "updatedAt") VALUES (${ids.guestListId}, ${ids.eventId}, 'Guests', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO guest (id, "guestListId", name, email, "responseStatus", "credentialStatus", "admissionTokenDigest", "createdAt", "updatedAt") VALUES (${ids.guestId}, ${ids.guestListId}, 'Guest attendee', 'guest@example.test', 'ACCEPTED', 'ACTIVE', ${`guest-digest-${ids.guestId}`}, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO check_in (id, "eventId", "ticketId", "checkedInByProfileId", "checkedInAt") VALUES (${randomUUID()}, ${ids.eventId}, ${ids.ticketId}, ${ids.organizerProfileId}, NOW())`;
  await client.$executeRaw`INSERT INTO check_in (id, "eventId", "guestId", "checkedInByProfileId", "checkedInAt") VALUES (${randomUUID()}, ${ids.eventId}, ${ids.guestId}, ${ids.organizerProfileId}, NOW())`;
}
