import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type Administration = {
  replacePlatformFeeRule(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    mode: 'FIXED' | 'PERCENTAGE';
    fixedAmountKobo?: number;
    percentageBasisPoints?: number;
    effectiveAt: Date;
    reason: string;
    now: Date;
  }): Promise<{ id: string; version: number; mode: 'FIXED' | 'PERCENTAGE' }>;
  blockProfile(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    profileId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  unblockProfile(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    profileId: string;
    now: Date;
  }): Promise<void>;
  suspendEvent(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    eventId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  restoreEvent(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    eventId: string;
  }): Promise<void>;
  setEventFeatured(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    eventId: string;
    featured: boolean;
  }): Promise<void>;
  approveRefundRequest(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    refundRequestId: string;
    ticketRefundKobo: number;
    platformFeeRefundKobo: number;
    reason: string;
    now: Date;
  }): Promise<void>;
  executeApprovedRefund(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    refundRequestId: string;
    gateway: {
      createRefund(input: {
        transactionReference: string;
        amountKobo: number;
        currency: string;
        customerNote: string;
        merchantNote: string;
      }): Promise<{ reference: string; status: 'pending' | 'processing' | 'needs-attention' | 'failed' | 'processed'; amountKobo: number; currency: string }>;
    };
    now: Date;
  }): Promise<{ reference: string; status: string; amountKobo: number; currency: string }>;
  reconcileExecutedRefund(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    refundRequestId: string;
    gateway: {
      fetchRefund(reference: string): Promise<{ reference: string; status: 'pending' | 'processing' | 'needs-attention' | 'failed' | 'processed'; amountKobo: number; currency: string }>;
    };
    now: Date;
  }): Promise<{ reference: string; status: string; amountKobo: number; currency: string }>;
  markRefundProcessed(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    refundRequestId: string;
    gatewayRefundReference: string;
    gatewayStatus: string;
    now: Date;
  }): Promise<void>;
  rejectRefundRequest(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    refundRequestId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  approvePayoutRequest(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    payoutRequestId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  markPayoutPaid(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    payoutRequestId: string;
    transferReference: string;
    transferDate: Date;
    now: Date;
  }): Promise<void>;
  rejectPayoutRequest(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
    payoutRequestId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  getAdministrationSummary(input: {
    database: ReturnType<typeof createDatabaseClient>;
    adminProfileId: string;
  }): Promise<{
    paidOrderCount: number;
    totalPaidKobo: number;
    platformFeeRevenueKobo: number;
    refundLiabilityKobo: number;
    payoutLiabilityKobo: number;
  }>;
  pageAdministrationEvents(input: { database: ReturnType<typeof createDatabaseClient>; adminProfileId: string; page: number; pageSize: number; skip: number; state?: string }): Promise<{ items: unknown[]; total: number }>;
  pageAdministrationProfiles(input: { database: ReturnType<typeof createDatabaseClient>; adminProfileId: string; page: number; pageSize: number; skip: number; query?: string }): Promise<{ items: unknown[]; total: number }>;
  pageAdministrationOrders(input: { database: ReturnType<typeof createDatabaseClient>; adminProfileId: string; page: number; pageSize: number; skip: number; query?: string }): Promise<{ items: unknown[]; total: number }>;
  pageAdministrationRefundRequests(input: { database: ReturnType<typeof createDatabaseClient>; adminProfileId: string; page: number; pageSize: number; skip: number; status?: string }): Promise<{ items: unknown[]; total: number }>;
  pageAdministrationPayoutRequests(input: { database: ReturnType<typeof createDatabaseClient>; adminProfileId: string; page: number; pageSize: number; skip: number; status?: string }): Promise<{ items: unknown[]; total: number }>;
};

async function loadAdministration(): Promise<Administration | undefined> {
  try {
    return await import('../src/admin/administration.js') as Administration;
  } catch {
    return undefined;
  }
}

describe('administration', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.adminProfileId) await client.$executeRaw`DELETE FROM audit_log WHERE "actorProfileId" = ${ids.adminProfileId}`;
      if (ids.targetUserId) await client.$executeRaw`DELETE FROM notification_job WHERE "recipientEmail" = ${`${ids.targetUserId}@example.test`}`;
      if (ids.refundRequestId) await client.$executeRaw`DELETE FROM refund_request_ticket WHERE "refundRequestId" = ${ids.refundRequestId}`;
      if (ids.refundRequestId) await client.$executeRaw`DELETE FROM refund_request WHERE id = ${ids.refundRequestId}`;
      if (ids.payoutRequestId) await client.$executeRaw`DELETE FROM payout_request WHERE id = ${ids.payoutRequestId}`;
      if (ids.ticketId) await client.$executeRaw`DELETE FROM ticket WHERE id = ${ids.ticketId}`;
      if (ids.paymentAttemptId) await client.$executeRaw`DELETE FROM payment_attempt WHERE id = ${ids.paymentAttemptId}`;
      if (ids.orderId) await client.$executeRaw`DELETE FROM "order" WHERE id = ${ids.orderId}`;
      if (ids.ticketTypeId) await client.$executeRaw`DELETE FROM ticket_type WHERE id = ${ids.ticketTypeId}`;
      if (ids.eventId) await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
      if (ids.eventCategoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.eventCategoryId}`;
      if (ids.replacementRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.replacementRuleId}`;
      if (ids.initialRuleId) await client.$executeRaw`DELETE FROM platform_fee_rule WHERE id = ${ids.initialRuleId}`;
      if (ids.targetUserId) await client.$executeRaw`DELETE FROM auth_user WHERE id = ${ids.targetUserId}`;
      if (ids.adminUserId) await client.$executeRaw`DELETE FROM auth_user WHERE id = ${ids.adminUserId}`;
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('replaces an active fee rule immutably under an active administrator', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    const effectiveAt = new Date('2031-06-01T00:00:00.000Z');
    const replacement = await administration.replacePlatformFeeRule({
      database: client,
      adminProfileId: ids.adminProfileId,
      mode: 'PERCENTAGE',
      percentageBasisPoints: 500,
      effectiveAt,
      reason: 'Updated service fee',
      now: new Date('2031-05-01T00:00:00.000Z'),
    });
    ids.replacementRuleId = replacement.id;

    expect(replacement).toEqual({ id: expect.any(String), version: 2, mode: 'PERCENTAGE' });
    await expect(client.platformFeeRule.findUnique({ where: { id: ids.initialRuleId }, select: { activeUntil: true } })).resolves.toEqual({ activeUntil: effectiveAt });
    await expect(client.auditLog.findFirst({ where: { actorProfileId: ids.adminProfileId, action: 'PLATFORM_FEE_RULE_REPLACED', targetId: replacement.id }, select: { targetType: true } })).resolves.toEqual({ targetType: 'PLATFORM_FEE_RULE' });
  });

  it('blocks an account, revokes its sessions, and records the administrator action', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await administration.blockProfile({ database: client, adminProfileId: ids.adminProfileId, profileId: ids.targetProfileId, reason: 'Repeated policy breach', now: new Date('2031-06-01T00:00:00.000Z') });

    await expect(client.applicationProfile.findUnique({ where: { id: ids.targetProfileId }, select: { status: true, blockedAt: true, blockReason: true } })).resolves.toEqual({ status: 'BLOCKED', blockedAt: new Date('2031-06-01T00:00:00.000Z'), blockReason: 'Repeated policy breach' });
    await expect(client.$queryRaw<Array<{ blockedByProfileId: string }>>`SELECT "blockedByProfileId" FROM application_profile WHERE id = ${ids.targetProfileId}`).resolves.toEqual([{ blockedByProfileId: ids.adminProfileId }]);
    await expect(client.auth_session.count({ where: { userId: ids.targetUserId } })).resolves.toBe(0);
    await expect(client.auditLog.findFirst({ where: { actorProfileId: ids.adminProfileId, action: 'ACCOUNT_BLOCKED', targetId: ids.targetProfileId }, select: { targetType: true } })).resolves.toEqual({ targetType: 'APPLICATION_PROFILE' });
  });

  it('unblocks a previously blocked account without restoring revoked sessions', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await administration.blockProfile({ database: client, adminProfileId: ids.adminProfileId, profileId: ids.targetProfileId, reason: 'Repeated policy breach', now: new Date('2031-06-01T00:00:00.000Z') });
    await administration.unblockProfile({ database: client, adminProfileId: ids.adminProfileId, profileId: ids.targetProfileId, now: new Date('2031-06-02T00:00:00.000Z') });

    await expect(client.applicationProfile.findUnique({ where: { id: ids.targetProfileId }, select: { status: true, blockedAt: true, blockReason: true } })).resolves.toEqual({ status: 'ACTIVE', blockedAt: null, blockReason: null });
    await expect(client.$queryRaw<Array<{ blockedByProfileId: string | null }>>`SELECT "blockedByProfileId" FROM application_profile WHERE id = ${ids.targetProfileId}`).resolves.toEqual([{ blockedByProfileId: null }]);
    await expect(client.auth_session.count({ where: { userId: ids.targetUserId } })).resolves.toBe(0);
    await expect(client.auditLog.findFirst({ where: { actorProfileId: ids.adminProfileId, action: 'ACCOUNT_UNBLOCKED', targetId: ids.targetProfileId }, select: { targetType: true } })).resolves.toEqual({ targetType: 'APPLICATION_PROFILE' });
  });

  it('suspends and restores a published event with administrator audit records', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await administration.suspendEvent({ database: client, adminProfileId: ids.adminProfileId, eventId: ids.eventId, reason: 'Safety review', now: new Date('2031-06-01T00:00:00.000Z') });

    await expect(client.event.findUnique({ where: { id: ids.eventId }, select: { status: true, suspendedAt: true, suspendedReason: true } })).resolves.toEqual({ status: 'SUSPENDED', suspendedAt: new Date('2031-06-01T00:00:00.000Z'), suspendedReason: 'Safety review' });
    await expect(client.auditLog.findFirst({ where: { actorProfileId: ids.adminProfileId, action: 'EVENT_SUSPENDED', targetId: ids.eventId }, select: { targetType: true } })).resolves.toEqual({ targetType: 'EVENT' });

    await administration.restoreEvent({ database: client, adminProfileId: ids.adminProfileId, eventId: ids.eventId });

    await expect(client.event.findUnique({ where: { id: ids.eventId }, select: { status: true, suspendedAt: true, suspendedReason: true } })).resolves.toEqual({ status: 'PUBLISHED', suspendedAt: null, suspendedReason: null });
    await expect(client.auditLog.findFirst({ where: { actorProfileId: ids.adminProfileId, action: 'EVENT_RESTORED', targetId: ids.eventId }, select: { targetType: true } })).resolves.toEqual({ targetType: 'EVENT' });
  });

  it('sets featured visibility for a published event and records it', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await administration.setEventFeatured({ database: client, adminProfileId: ids.adminProfileId, eventId: ids.eventId, featured: true });

    await expect(client.event.findUnique({ where: { id: ids.eventId }, select: { featured: true } })).resolves.toEqual({ featured: true });
    await expect(client.auditLog.findFirst({ where: { actorProfileId: ids.adminProfileId, action: 'EVENT_FEATURED_UPDATED', targetId: ids.eventId }, select: { targetType: true, details: true } })).resolves.toEqual({ targetType: 'EVENT', details: { featured: true } });
  });

  it('executes an approved refund once and revokes only its selected tickets after provider completion', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await createRefundFixture(client, ids);
    await administration.approveRefundRequest({ database: client, adminProfileId: ids.adminProfileId, refundRequestId: ids.refundRequestId, ticketRefundKobo: 2000, platformFeeRefundKobo: 100, reason: 'Validated refund amount', now: new Date('2031-06-01T00:00:00.000Z') });

    await expect(client.refundRequest.findUnique({ where: { id: ids.refundRequestId }, select: { status: true, totalRefundKobo: true, processedAt: true } })).resolves.toEqual({ status: 'APPROVED', totalRefundKobo: 2100, processedAt: null });
    await expect(client.ticket.findUnique({ where: { id: ids.ticketId }, select: { status: true } })).resolves.toEqual({ status: 'ACTIVE' });
    const gatewayCalls: unknown[] = [];
    const gateway = {
      createRefund: async (input: unknown) => {
        gatewayCalls.push(input);
        return { reference: '3018284', status: 'pending' as const, amountKobo: 2100, currency: 'NGN' };
      },
    };
    await expect(administration.executeApprovedRefund({ database: client, adminProfileId: ids.adminProfileId, refundRequestId: ids.refundRequestId, gateway, now: new Date('2031-06-01T01:00:00.000Z') })).resolves.toEqual({ reference: '3018284', status: 'pending', amountKobo: 2100, currency: 'NGN' });
    expect(gatewayCalls).toEqual([{
      transactionReference: `pay-${ids.orderId}`,
      amountKobo: 2100,
      currency: 'NGN',
      customerNote: 'Customer request',
      merchantNote: `EverythingTicket refund ${ids.refundRequestId}`,
    }]);
    await expect(client.refundRequest.findUnique({ where: { id: ids.refundRequestId }, select: { status: true, gatewayRefundReference: true, gatewayStatus: true, processedAt: true } })).resolves.toEqual({ status: 'PROCESSING', gatewayRefundReference: '3018284', gatewayStatus: 'pending', processedAt: null });
    await expect(client.ticket.findUnique({ where: { id: ids.ticketId }, select: { status: true } })).resolves.toEqual({ status: 'ACTIVE' });
    await expect(administration.executeApprovedRefund({ database: client, adminProfileId: ids.adminProfileId, refundRequestId: ids.refundRequestId, gateway, now: new Date('2031-06-01T01:01:00.000Z') })).rejects.toThrow('refund is unavailable');
    expect(gatewayCalls).toHaveLength(1);
    const reconciliationCalls: string[] = [];
    const reconciliationGateway = {
      fetchRefund: async (reference: string) => {
        reconciliationCalls.push(reference);
        return { reference, status: 'processed' as const, amountKobo: 2100, currency: 'NGN' };
      },
    };
    await expect(administration.reconcileExecutedRefund({ database: client, adminProfileId: ids.adminProfileId, refundRequestId: ids.refundRequestId, gateway: reconciliationGateway, now: new Date('2031-06-02T00:00:00.000Z') })).resolves.toEqual({ reference: '3018284', status: 'processed', amountKobo: 2100, currency: 'NGN' });
    expect(reconciliationCalls).toEqual(['3018284']);

    await expect(client.refundRequest.findUnique({ where: { id: ids.refundRequestId }, select: { status: true, gatewayRefundReference: true, gatewayStatus: true, processedAt: true } })).resolves.toEqual({ status: 'PROCESSED', gatewayRefundReference: '3018284', gatewayStatus: 'processed', processedAt: new Date('2031-06-02T00:00:00.000Z') });
    await expect(client.ticket.findUnique({ where: { id: ids.ticketId }, select: { status: true } })).resolves.toEqual({ status: 'REVOKED' });
    await expect(client.auditLog.findMany({ where: { actorProfileId: ids.adminProfileId, targetId: ids.refundRequestId }, select: { action: true }, orderBy: { createdAt: 'asc' } })).resolves.toEqual([{ action: 'REFUND_APPROVED' }, { action: 'REFUND_EXECUTED' }, { action: 'REFUND_PROCESSED' }]);
    await expect(client.notificationJob.count({ where: { recipientEmail: `${ids.targetUserId}@example.test`, type: 'REFUND_DECISION' } })).resolves.toBe(2);
  });

  it('releases a failed refund for retry only after Paystack confirms the prior refund failed', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await createRefundFixture(client, ids);
    await administration.approveRefundRequest({ database: client, adminProfileId: ids.adminProfileId, refundRequestId: ids.refundRequestId, ticketRefundKobo: 2000, platformFeeRefundKobo: 100, reason: 'Validated refund amount', now: new Date('2031-06-01T00:00:00.000Z') });
    await client.refundRequest.update({ where: { id: ids.refundRequestId }, data: { status: 'FAILED', gatewayRefundReference: 'refund-failed-1', gatewayStatus: 'failed' } });

    const result = await administration.reconcileExecutedRefund({
      database: client,
      adminProfileId: ids.adminProfileId,
      refundRequestId: ids.refundRequestId,
      gateway: { fetchRefund: async (reference) => ({ reference, status: 'failed', amountKobo: 2100, currency: 'NGN' }) },
      now: new Date('2031-06-02T00:00:00.000Z'),
    });

    expect(result.status).toBe('failed');
    await expect(client.refundRequest.findUnique({ where: { id: ids.refundRequestId }, select: { status: true, gatewayRefundReference: true, gatewayStatus: true } })).resolves.toEqual({ status: 'APPROVED', gatewayRefundReference: null, gatewayStatus: 'retry-approved' });
    await expect(client.auditLog.count({ where: { targetId: ids.refundRequestId, action: 'REFUND_RETRY_APPROVED' } })).resolves.toBe(1);
  });

  it('records an approved payout as paid once an external transfer reference and date exist', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await createPayoutFixture(client, ids);
    await administration.approvePayoutRequest({ database: client, adminProfileId: ids.adminProfileId, payoutRequestId: ids.payoutRequestId, reason: 'Event ledger reviewed', now: new Date('2031-06-01T00:00:00.000Z') });
    await expect(client.payoutRequest.findUnique({ where: { id: ids.payoutRequestId }, select: { status: true, paidAt: true } })).resolves.toEqual({ status: 'APPROVED', paidAt: null });
    await administration.markPayoutPaid({ database: client, adminProfileId: ids.adminProfileId, payoutRequestId: ids.payoutRequestId, transferReference: 'TRF_123', transferDate: new Date('2031-06-02T10:30:00.000Z'), now: new Date('2031-06-02T11:00:00.000Z') });

    await expect(client.payoutRequest.findUnique({ where: { id: ids.payoutRequestId }, select: { status: true, transferReference: true, transferDate: true, paidAt: true } })).resolves.toEqual({ status: 'PAID', transferReference: 'TRF_123', transferDate: new Date('2031-06-02T10:30:00.000Z'), paidAt: new Date('2031-06-02T11:00:00.000Z') });
    await expect(administration.markPayoutPaid({ database: client, adminProfileId: ids.adminProfileId, payoutRequestId: ids.payoutRequestId, transferReference: 'TRF_124', transferDate: new Date('2031-06-02T10:40:00.000Z'), now: new Date('2031-06-02T11:05:00.000Z') })).rejects.toThrow('payout is unavailable');
    await expect(client.auditLog.findMany({ where: { actorProfileId: ids.adminProfileId, targetId: ids.payoutRequestId }, select: { action: true }, orderBy: { createdAt: 'asc' } })).resolves.toEqual([{ action: 'PAYOUT_APPROVED' }, { action: 'PAYOUT_PAID' }]);
    await expect(client.notificationJob.count({ where: { recipientEmail: `${ids.targetUserId}@example.test`, type: 'PAYOUT_DECISION' } })).resolves.toBe(2);
  });

  it('rejects requested refunds and payouts without revoking tickets or moving money', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await createRefundFixture(client, ids);
    await createPayoutFixture(client, ids);
    await administration.rejectRefundRequest({ database: client, adminProfileId: ids.adminProfileId, refundRequestId: ids.refundRequestId, reason: 'Requested amount is unsupported', now: new Date('2031-06-01T00:00:00.000Z') });
    await administration.rejectPayoutRequest({ database: client, adminProfileId: ids.adminProfileId, payoutRequestId: ids.payoutRequestId, reason: 'Reconcile refund liability first', now: new Date('2031-06-01T00:00:00.000Z') });

    await expect(client.refundRequest.findUnique({ where: { id: ids.refundRequestId }, select: { status: true, reviewReason: true } })).resolves.toEqual({ status: 'REJECTED', reviewReason: 'Requested amount is unsupported' });
    await expect(client.ticket.findUnique({ where: { id: ids.ticketId }, select: { status: true } })).resolves.toEqual({ status: 'ACTIVE' });
    await expect(client.payoutRequest.findUnique({ where: { id: ids.payoutRequestId }, select: { status: true, reviewReason: true, transferReference: true } })).resolves.toEqual({ status: 'REJECTED', reviewReason: 'Reconcile refund liability first', transferReference: null });
    await expect(client.notificationJob.count({ where: { recipientEmail: `${ids.targetUserId}@example.test`, type: { in: ['REFUND_DECISION', 'PAYOUT_DECISION'] } } })).resolves.toBe(2);
  });

  it('reports platform payment totals and outstanding financial liabilities to an administrator', async () => {
    const administration = await loadAdministration();
    const databaseUrl = process.env.DATABASE_URL;
    expect(administration).toBeDefined();
    if (!administration || !databaseUrl) throw new Error('administration is unavailable');

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createAdminFeeFixture(client, ids);
    const baseline = await administration.getAdministrationSummary({ database: client, adminProfileId: ids.adminProfileId });
    await createTargetProfile(client, ids);
    await createPublishedEvent(client, ids);
    await createRefundFixture(client, ids);
    await createPayoutFixture(client, ids);

    const page = { page: 1, pageSize: 10, skip: 0 };
    await expect(administration.pageAdministrationEvents({ database: client, adminProfileId: ids.adminProfileId, ...page, state: 'CANCELLED' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(administration.pageAdministrationProfiles({ database: client, adminProfileId: ids.adminProfileId, ...page, query: 'no-match@example.test' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(administration.pageAdministrationOrders({ database: client, adminProfileId: ids.adminProfileId, ...page, query: 'no-match' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(administration.pageAdministrationRefundRequests({ database: client, adminProfileId: ids.adminProfileId, ...page, status: 'CANCELLED' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));
    await expect(administration.pageAdministrationPayoutRequests({ database: client, adminProfileId: ids.adminProfileId, ...page, status: 'PAID' })).resolves.toEqual(expect.objectContaining({ items: [], total: 0 }));

    await expect(administration.getAdministrationSummary({ database: client, adminProfileId: ids.adminProfileId })).resolves.toEqual({
      paidOrderCount: baseline.paidOrderCount + 1,
      totalPaidKobo: baseline.totalPaidKobo + 2100,
      platformFeeRevenueKobo: baseline.platformFeeRevenueKobo + 100,
      refundLiabilityKobo: baseline.refundLiabilityKobo + 2100,
      payoutLiabilityKobo: baseline.payoutLiabilityKobo + 4000,
    });
  });
});

async function createAdminFeeFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { adminUserId: randomUUID(), adminProfileId: randomUUID(), initialRuleId: randomUUID() });
  await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${ids.adminUserId}, 'Admin', ${`${ids.adminUserId}@example.test`}, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${ids.adminProfileId}, ${ids.adminUserId}, 'ADMIN', 'ACTIVE', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO platform_fee_rule (id, version, mode, "fixedAmountKobo", "activeFrom", "createdAt") VALUES (${ids.initialRuleId}, 1, 'FIXED', 100, '2030-01-01T00:00:00.000Z', NOW())`;
}

async function createTargetProfile(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { targetUserId: randomUUID(), targetProfileId: randomUUID(), targetSessionId: randomUUID() });
  await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${ids.targetUserId}, 'Target', ${`${ids.targetUserId}@example.test`}, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${ids.targetProfileId}, ${ids.targetUserId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO auth_session (id, "expiresAt", token, "userId", "createdAt", "updatedAt") VALUES (${ids.targetSessionId}, '2032-01-01T00:00:00.000Z', ${`session-${ids.targetSessionId}`}, ${ids.targetUserId}, NOW(), NOW())`;
}

async function createPublishedEvent(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { eventId: randomUUID(), eventCategoryId: randomUUID() });
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.eventCategoryId}, ${`Category ${ids.eventCategoryId}`}, ${`category-${ids.eventCategoryId}`}, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, ${ids.targetProfileId}, ${ids.eventCategoryId}, 'Test Event', ${`test-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2031-07-01T10:00:00.000Z', '2031-07-01T12:00:00.000Z', 'PUBLISHED', NOW(), NOW(), NOW())`;
}

async function createRefundFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { ticketTypeId: randomUUID(), orderId: randomUUID(), paymentAttemptId: randomUUID(), ticketId: randomUUID(), refundRequestId: randomUUID() });
  await client.$executeRaw`INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt") VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'General', 2000, 10, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO "order" (id, reference, "eventId", "buyerName", "buyerEmail", currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo", "holdExpiresAt", status, "paidAt", "createdAt") VALUES (${ids.orderId}, ${`order-${ids.orderId}`}, ${ids.eventId}, 'Buyer', ${`${ids.orderId}@example.test`}, 'NGN', 2000, 100, 2100, ${ids.initialRuleId}, 1, 'FIXED', 100, '2031-06-10T10:00:00.000Z', 'PAID', '2031-05-01T10:00:00.000Z', NOW())`;
  await client.$executeRaw`INSERT INTO payment_attempt (id, "orderId", reference, "expectedAmountKobo", currency, status, "verifiedAt", "createdAt") VALUES (${ids.paymentAttemptId}, ${ids.orderId}, ${`pay-${ids.orderId}`}, 2100, 'NGN', 'VERIFIED_SUCCESS', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO ticket (id, "orderId", "eventId", "ticketTypeId", "holderName", "holderEmail", "ticketTypeName", "priceKobo", "admissionTokenDigest", "issuedAt") VALUES (${ids.ticketId}, ${ids.orderId}, ${ids.eventId}, ${ids.ticketTypeId}, 'Buyer', 'buyer@example.test', 'General', 2000, ${`digest-${ids.ticketId}`}, NOW())`;
  await client.$executeRaw`INSERT INTO refund_request (id, "organizerProfileId", "eventId", "orderId", "ticketRefundKobo", "platformFeeRefundKobo", "totalRefundKobo", reason, "requestedAt", "createdAt", "updatedAt") VALUES (${ids.refundRequestId}, ${ids.targetProfileId}, ${ids.eventId}, ${ids.orderId}, 2000, 100, 2100, 'Customer request', NOW(), NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO refund_request_ticket ("refundRequestId", "ticketId") VALUES (${ids.refundRequestId}, ${ids.ticketId})`;
}

async function createPayoutFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { payoutRequestId: randomUUID() });
  await client.$executeRaw`INSERT INTO payout_request (id, "organizerProfileId", "eventId", "ticketSubtotalKobo", "reservedRefundKobo", "priorPaidKobo", "requestedAmountKobo", "calculatedPayableKobo", "requestedAt", "createdAt", "updatedAt") VALUES (${ids.payoutRequestId}, ${ids.targetProfileId}, ${ids.eventId}, 4000, 0, 0, 4000, 4000, NOW(), NOW(), NOW())`;
}
