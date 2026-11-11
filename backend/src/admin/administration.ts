import type { PrismaClient } from '../generated/prisma/client.js';
import { profileHasRole, profileRoleFilter } from '../identity/current-profile.js';
import type { PaystackRefund, RefundGateway } from '../payments/paystack-gateway.js';

export async function replacePlatformFeeRule({
  database,
  adminProfileId,
  mode,
  fixedAmountKobo,
  percentageBasisPoints,
  effectiveAt,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  mode: 'FIXED' | 'PERCENTAGE';
  fixedAmountKobo?: number;
  percentageBasisPoints?: number;
  effectiveAt: Date;
  reason: string;
  now: Date;
}): Promise<{ id: string; version: number; mode: 'FIXED' | 'PERCENTAGE' }> {
  if (!reason.trim() || effectiveAt < now) throw new RangeError('reason and a current or future effective time are required');
  if (mode === 'FIXED') {
    if (fixedAmountKobo === undefined || !Number.isSafeInteger(fixedAmountKobo) || fixedAmountKobo < 0 || percentageBasisPoints !== undefined) throw new RangeError('fixed fee configuration is invalid');
  } else if (percentageBasisPoints === undefined || !Number.isSafeInteger(percentageBasisPoints) || percentageBasisPoints < 0 || fixedAmountKobo !== undefined) {
    throw new RangeError('percentage fee configuration is invalid');
  }
  return database.$transaction(async (transaction) => {
    const admin = await transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
    if (!admin) throw new Error('administrator access is unavailable');
    const activeRule = await transaction.platformFeeRule.findFirst({
      where: { activeFrom: { lte: effectiveAt }, OR: [{ activeUntil: null }, { activeUntil: { gt: effectiveAt } }] },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!activeRule) throw new Error('no active platform fee rule exists');
    const version = (await transaction.platformFeeRule.aggregate({ _max: { version: true } }))._max.version ?? 0;
    await transaction.platformFeeRule.update({ where: { id: activeRule.id }, data: { activeUntil: effectiveAt } });
    const replacement = await transaction.platformFeeRule.create({
      data: {
        version: version + 1,
        mode,
        fixedAmountKobo: mode === 'FIXED' ? fixedAmountKobo as number : null,
        percentageBasisPoints: mode === 'PERCENTAGE' ? percentageBasisPoints as number : null,
        activeFrom: effectiveAt,
        changedByProfileId: admin.id,
      },
      select: { id: true, version: true, mode: true },
    });
    await transaction.auditLog.create({
      data: {
        actorProfileId: admin.id,
        action: 'PLATFORM_FEE_RULE_REPLACED',
        targetType: 'PLATFORM_FEE_RULE',
        targetId: replacement.id,
        details: { previousRuleId: activeRule.id, reason: reason.trim() },
      },
    });
    return replacement;
  });
}

export async function blockProfile({
  database,
  adminProfileId,
  profileId,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  profileId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  if (!reason.trim() || profileId === adminProfileId) throw new RangeError('a different profile and block reason are required');
  await database.$transaction(async (transaction) => {
    const admin = await transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
    const target = await transaction.applicationProfile.findFirst({ where: { id: profileId, status: 'ACTIVE' }, select: { id: true, userId: true, role: true, roles: true } });
    if (!admin || !target || profileHasRole(target, 'ADMIN')) throw new Error('account is unavailable for this administrator');
    await transaction.applicationProfile.update({ where: { id: target.id }, data: { status: 'BLOCKED', blockedAt: now, blockedByProfileId: admin.id, blockReason: reason.trim() } });
    await transaction.auth_session.deleteMany({ where: { userId: target.userId } });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'ACCOUNT_BLOCKED', targetType: 'APPLICATION_PROFILE', targetId: target.id, details: { reason: reason.trim() } },
    });
  });
}

export async function unblockProfile({
  database,
  adminProfileId,
  profileId,
}: {
  database: PrismaClient;
  adminProfileId: string;
  profileId: string;
  now: Date;
}): Promise<void> {
  if (profileId === adminProfileId) throw new RangeError('a different profile is required');
  await database.$transaction(async (transaction) => {
    const admin = await transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
    const target = await transaction.applicationProfile.findFirst({ where: { id: profileId, status: 'BLOCKED' }, select: { id: true, role: true, roles: true } });
    if (!admin || !target || profileHasRole(target, 'ADMIN')) throw new Error('account is unavailable for this administrator');
    await transaction.applicationProfile.update({ where: { id: target.id }, data: { status: 'ACTIVE', blockedAt: null, blockedByProfileId: null, blockReason: null } });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'ACCOUNT_UNBLOCKED', targetType: 'APPLICATION_PROFILE', targetId: target.id },
    });
  });
}

export async function suspendEvent({
  database,
  adminProfileId,
  eventId,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  eventId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  if (!reason.trim()) throw new RangeError('a suspension reason is required');
  await database.$transaction(async (transaction) => {
    const admin = await transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
    const event = await transaction.event.findFirst({ where: { id: eventId, status: 'PUBLISHED' }, select: { id: true } });
    if (!admin || !event) throw new Error('event is unavailable for this administrator');
    await transaction.event.update({ where: { id: event.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspendedReason: reason.trim() } });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'EVENT_SUSPENDED', targetType: 'EVENT', targetId: event.id, details: { reason: reason.trim() } },
    });
  });
}

export async function restoreEvent({
  database,
  adminProfileId,
  eventId,
}: {
  database: PrismaClient;
  adminProfileId: string;
  eventId: string;
}): Promise<void> {
  await database.$transaction(async (transaction) => {
    const admin = await transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
    const event = await transaction.event.findFirst({ where: { id: eventId, status: 'SUSPENDED' }, select: { id: true } });
    if (!admin || !event) throw new Error('event is unavailable for this administrator');
    await transaction.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED', suspendedAt: null, suspendedReason: null } });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'EVENT_RESTORED', targetType: 'EVENT', targetId: event.id },
    });
  });
}

export async function setEventFeatured({
  database,
  adminProfileId,
  eventId,
  featured,
}: {
  database: PrismaClient;
  adminProfileId: string;
  eventId: string;
  featured: boolean;
}): Promise<void> {
  await database.$transaction(async (transaction) => {
    const admin = await transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
    const event = await transaction.event.findFirst({ where: { id: eventId, status: 'PUBLISHED' }, select: { id: true } });
    if (!admin || !event) throw new Error('event is unavailable for this administrator');
    await transaction.event.update({ where: { id: event.id }, data: { featured } });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'EVENT_FEATURED_UPDATED', targetType: 'EVENT', targetId: event.id, details: { featured } },
    });
  });
}

export async function approveRefundRequest({
  database,
  adminProfileId,
  refundRequestId,
  ticketRefundKobo,
  platformFeeRefundKobo,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  refundRequestId: string;
  ticketRefundKobo: number;
  platformFeeRefundKobo: number;
  reason: string;
  now: Date;
}): Promise<void> {
  if (!reason.trim() || !isNonNegativeInteger(ticketRefundKobo) || !isNonNegativeInteger(platformFeeRefundKobo) || ticketRefundKobo + platformFeeRefundKobo < 1) {
    throw new RangeError('refund review values are invalid');
  }
  await database.$transaction(async (transaction) => {
    const [admin, refund] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.refundRequest.findFirst({
        where: { id: refundRequestId, status: 'REQUESTED' },
        select: { id: true, organizer: { select: { user: { select: { email: true } } } }, order: { select: { platformFeeKobo: true } }, tickets: { select: { ticket: { select: { priceKobo: true } } } } },
      }),
    ]);
    if (!admin || !refund) throw new Error('refund is unavailable for this administrator');
    const selectedTicketValue = refund.tickets.reduce((total, item) => total + item.ticket.priceKobo, 0);
    if (ticketRefundKobo > selectedTicketValue || platformFeeRefundKobo > refund.order.platformFeeKobo) throw new RangeError('refund exceeds its order value');
    const totalRefundKobo = ticketRefundKobo + platformFeeRefundKobo;
    await transaction.refundRequest.update({
      where: { id: refund.id },
      data: { status: 'APPROVED', ticketRefundKobo, platformFeeRefundKobo, totalRefundKobo, reviewedByProfileId: admin.id, reviewedAt: now, reviewReason: reason.trim() },
    });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'REFUND_APPROVED', targetType: 'REFUND_REQUEST', targetId: refund.id, details: { ticketRefundKobo, platformFeeRefundKobo, reason: reason.trim() } },
    });
    await transaction.notificationJob.create({
      data: { type: 'REFUND_DECISION', recipientEmail: refund.organizer.user.email, idempotencyKey: `refund:${refund.id}:approved` },
    });
  });
}

export async function markRefundProcessed({
  database,
  adminProfileId,
  refundRequestId,
  gatewayRefundReference,
  gatewayStatus,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  refundRequestId: string;
  gatewayRefundReference: string;
  gatewayStatus: string;
  now: Date;
}): Promise<void> {
  if (!gatewayRefundReference.trim() || !gatewayStatus.trim()) throw new RangeError('gateway refund evidence is required');
  await database.$transaction(async (transaction) => {
    const [admin, refund] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.refundRequest.findFirst({ where: { id: refundRequestId, status: { in: ['APPROVED', 'PROCESSING'] } }, select: { id: true, organizer: { select: { user: { select: { email: true } } } }, tickets: { select: { ticketId: true } } } }),
    ]);
    if (!admin || !refund) throw new Error('refund is unavailable for this administrator');
    await transaction.refundRequest.update({
      where: { id: refund.id },
      data: { status: 'PROCESSED', gatewayRefundReference: gatewayRefundReference.trim(), gatewayStatus: gatewayStatus.trim(), processedAt: now },
    });
    await transaction.ticket.updateMany({ where: { id: { in: refund.tickets.map((item) => item.ticketId) } }, data: { status: 'REVOKED' } });
    await transaction.auditLog.create({
      data: { actorProfileId: admin.id, action: 'REFUND_PROCESSED', targetType: 'REFUND_REQUEST', targetId: refund.id, details: { gatewayRefundReference: gatewayRefundReference.trim(), gatewayStatus: gatewayStatus.trim() } },
    });
    await transaction.notificationJob.create({
      data: { type: 'REFUND_DECISION', recipientEmail: refund.organizer.user.email, idempotencyKey: `refund:${refund.id}:processed` },
    });
  });
}

export async function executeApprovedRefund({
  database,
  adminProfileId,
  refundRequestId,
  gateway,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  refundRequestId: string;
  gateway: Pick<RefundGateway, 'createRefund'>;
  now: Date;
}): Promise<PaystackRefund> {
  const refund = await database.$transaction(async (transaction) => {
    const [admin, approved] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.refundRequest.findFirst({
        where: { id: refundRequestId, status: 'APPROVED' },
        select: {
          id: true,
          totalRefundKobo: true,
          reason: true,
          order: {
            select: {
              currency: true,
              paymentAttempts: { where: { status: 'VERIFIED_SUCCESS' }, orderBy: { verifiedAt: 'desc' }, take: 1, select: { reference: true } },
            },
          },
        },
      }),
    ]);
    const transactionReference = approved?.order.paymentAttempts[0]?.reference;
    if (!admin || !approved || !transactionReference) throw new Error('refund is unavailable for this administrator');
    const claimed = await transaction.refundRequest.updateMany({ where: { id: approved.id, status: 'APPROVED' }, data: { status: 'PROCESSING', gatewayStatus: 'initiating' } });
    if (claimed.count !== 1) throw new Error('refund is unavailable for this administrator');
    return { ...approved, transactionReference };
  });

  let result: PaystackRefund;
  try {
    result = await gateway.createRefund({
      transactionReference: refund.transactionReference,
      amountKobo: refund.totalRefundKobo,
      currency: refund.order.currency,
      customerNote: refund.reason,
      merchantNote: `EverythingTicket refund ${refund.id}`,
    });
  } catch (error) {
    await database.refundRequest.updateMany({ where: { id: refund.id, status: 'PROCESSING', gatewayStatus: 'initiating' }, data: { gatewayStatus: 'unknown' } });
    throw error;
  }

  if (result.amountKobo !== refund.totalRefundKobo || result.currency !== refund.order.currency) {
    await database.refundRequest.updateMany({ where: { id: refund.id, status: 'PROCESSING' }, data: { status: 'FAILED', gatewayRefundReference: result.reference, gatewayStatus: 'response-mismatch' } });
    throw new Error('Paystack refund response does not match the approved refund');
  }
  await applyRefundProviderResult({ database, adminProfileId, refundRequestId: refund.id, result, now, auditAction: 'REFUND_EXECUTED' });
  return result;
}

export async function reconcileExecutedRefund({
  database,
  adminProfileId,
  refundRequestId,
  gateway,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  refundRequestId: string;
  gateway: Pick<RefundGateway, 'fetchRefund'>;
  now: Date;
}): Promise<PaystackRefund> {
  const refund = await database.$transaction(async (transaction) => {
    const [admin, processing] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.refundRequest.findFirst({
        where: { id: refundRequestId, status: { in: ['PROCESSING', 'FAILED'] }, gatewayRefundReference: { not: null } },
        select: { id: true, status: true, totalRefundKobo: true, gatewayRefundReference: true, gatewayStatus: true, order: { select: { currency: true } } },
      }),
    ]);
    const gatewayRefundReference = processing?.gatewayRefundReference;
    const gatewayStatus = processing?.gatewayStatus;
    if (!admin || !processing || !gatewayRefundReference || !gatewayStatus || gatewayStatus === 'reconciling') throw new Error('refund is unavailable for this administrator');
    const claimed = await transaction.refundRequest.updateMany({
      where: { id: processing.id, status: processing.status, gatewayStatus },
      data: { status: 'PROCESSING', gatewayStatus: 'reconciling' },
    });
    if (claimed.count !== 1) throw new Error('refund is unavailable for this administrator');
    return { ...processing, gatewayRefundReference, gatewayStatus };
  });

  let result: PaystackRefund;
  try {
    result = await gateway.fetchRefund(refund.gatewayRefundReference);
  } catch (error) {
    await database.refundRequest.updateMany({ where: { id: refund.id, status: 'PROCESSING', gatewayStatus: 'reconciling' }, data: { status: refund.status, gatewayStatus: refund.gatewayStatus } });
    throw error;
  }
  if (result.reference !== refund.gatewayRefundReference || result.amountKobo !== refund.totalRefundKobo || result.currency !== refund.order.currency) {
    await database.refundRequest.updateMany({ where: { id: refund.id, status: 'PROCESSING' }, data: { status: 'FAILED', gatewayStatus: 'response-mismatch' } });
    throw new Error('Paystack refund response does not match the approved refund');
  }
  if (refund.status === 'FAILED' && result.status === 'failed') {
    await database.$transaction(async (transaction) => {
      const released = await transaction.refundRequest.updateMany({ where: { id: refund.id, status: 'PROCESSING', gatewayStatus: 'reconciling' }, data: { status: 'APPROVED', gatewayRefundReference: null, gatewayStatus: 'retry-approved' } });
      if (released.count !== 1) throw new Error('refund recovery lost its claim');
      await transaction.auditLog.create({ data: { actorProfileId: adminProfileId, action: 'REFUND_RETRY_APPROVED', targetType: 'REFUND_REQUEST', targetId: refund.id, details: { confirmedFailedReference: result.reference } } });
    });
    return result;
  }
  await applyRefundProviderResult({ database, adminProfileId, refundRequestId: refund.id, result, now, auditAction: result.status === 'processed' ? 'REFUND_PROCESSED' : 'REFUND_RECONCILED' });
  return result;
}

async function applyRefundProviderResult({
  database,
  adminProfileId,
  refundRequestId,
  result,
  now,
  auditAction,
}: {
  database: PrismaClient;
  adminProfileId: string;
  refundRequestId: string;
  result: PaystackRefund;
  now: Date;
  auditAction: string;
}): Promise<void> {
  await database.$transaction(async (transaction) => {
    const refund = await transaction.refundRequest.findUniqueOrThrow({
      where: { id: refundRequestId },
      select: { organizer: { select: { user: { select: { email: true } } } }, tickets: { select: { ticketId: true } } },
    });
    const status = result.status === 'processed' ? 'PROCESSED' : result.status === 'failed' || result.status === 'needs-attention' ? 'FAILED' : 'PROCESSING';
    await transaction.refundRequest.update({
      where: { id: refundRequestId },
      data: { status, gatewayRefundReference: result.reference, gatewayStatus: result.status, ...(status === 'PROCESSED' ? { processedAt: now } : {}) },
    });
    if (status === 'PROCESSED') {
      await transaction.ticket.updateMany({ where: { id: { in: refund.tickets.map(({ ticketId }) => ticketId) } }, data: { status: 'REVOKED' } });
    }
    await transaction.auditLog.create({
      data: { actorProfileId: adminProfileId, action: auditAction, targetType: 'REFUND_REQUEST', targetId: refundRequestId, details: { gatewayRefundReference: result.reference, gatewayStatus: result.status } },
    });
    if (status === 'PROCESSED' || status === 'FAILED') {
      await transaction.notificationJob.create({
        data: { type: 'REFUND_DECISION', recipientEmail: refund.organizer.user.email, idempotencyKey: `refund:${refundRequestId}:${status.toLowerCase()}` },
      });
    }
  });
}

export async function rejectRefundRequest({
  database,
  adminProfileId,
  refundRequestId,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  refundRequestId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  if (!reason.trim()) throw new RangeError('a refund review reason is required');
  await database.$transaction(async (transaction) => {
    const [admin, refund] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.refundRequest.findFirst({ where: { id: refundRequestId, status: 'REQUESTED' }, select: { id: true, organizer: { select: { user: { select: { email: true } } } } } }),
    ]);
    if (!admin || !refund) throw new Error('refund is unavailable for this administrator');
    await transaction.refundRequest.update({ where: { id: refund.id }, data: { status: 'REJECTED', reviewedByProfileId: admin.id, reviewedAt: now, reviewReason: reason.trim() } });
    await transaction.auditLog.create({ data: { actorProfileId: admin.id, action: 'REFUND_REJECTED', targetType: 'REFUND_REQUEST', targetId: refund.id, details: { reason: reason.trim() } } });
    await transaction.notificationJob.create({
      data: { type: 'REFUND_DECISION', recipientEmail: refund.organizer.user.email, idempotencyKey: `refund:${refund.id}:rejected` },
    });
  });
}

export async function approvePayoutRequest({
  database,
  adminProfileId,
  payoutRequestId,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  payoutRequestId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  if (!reason.trim()) throw new RangeError('a payout review reason is required');
  await database.$transaction(async (transaction) => {
    const [admin, payout] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.payoutRequest.findFirst({ where: { id: payoutRequestId, status: 'REQUESTED' }, select: { id: true, organizer: { select: { user: { select: { email: true } } } } } }),
    ]);
    if (!admin || !payout) throw new Error('payout is unavailable for this administrator');
    await transaction.payoutRequest.update({ where: { id: payout.id }, data: { status: 'APPROVED', reviewedByProfileId: admin.id, reviewedAt: now, reviewReason: reason.trim() } });
    await transaction.auditLog.create({ data: { actorProfileId: admin.id, action: 'PAYOUT_APPROVED', targetType: 'PAYOUT_REQUEST', targetId: payout.id, details: { reason: reason.trim() } } });
    await transaction.notificationJob.create({
      data: { type: 'PAYOUT_DECISION', recipientEmail: payout.organizer.user.email, idempotencyKey: `payout:${payout.id}:approved` },
    });
  });
}

export async function markPayoutPaid({
  database,
  adminProfileId,
  payoutRequestId,
  transferReference,
  transferDate,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  payoutRequestId: string;
  transferReference: string;
  transferDate: Date;
  now: Date;
}): Promise<void> {
  if (!transferReference.trim() || Number.isNaN(transferDate.getTime())) throw new RangeError('transfer reference and date are required');
  await database.$transaction(async (transaction) => {
    const [admin, payout] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.payoutRequest.findFirst({ where: { id: payoutRequestId, status: 'APPROVED' }, select: { id: true, organizer: { select: { user: { select: { email: true } } } } } }),
    ]);
    if (!admin || !payout) throw new Error('payout is unavailable for this administrator');
    await transaction.payoutRequest.update({ where: { id: payout.id }, data: { status: 'PAID', transferReference: transferReference.trim(), transferDate, paidAt: now } });
    await transaction.auditLog.create({ data: { actorProfileId: admin.id, action: 'PAYOUT_PAID', targetType: 'PAYOUT_REQUEST', targetId: payout.id, details: { transferReference: transferReference.trim(), transferDate } } });
    await transaction.notificationJob.create({
      data: { type: 'PAYOUT_DECISION', recipientEmail: payout.organizer.user.email, idempotencyKey: `payout:${payout.id}:paid` },
    });
  });
}

export async function rejectPayoutRequest({
  database,
  adminProfileId,
  payoutRequestId,
  reason,
  now,
}: {
  database: PrismaClient;
  adminProfileId: string;
  payoutRequestId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  if (!reason.trim()) throw new RangeError('a payout review reason is required');
  await database.$transaction(async (transaction) => {
    const [admin, payout] = await Promise.all([
      transaction.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } }),
      transaction.payoutRequest.findFirst({ where: { id: payoutRequestId, status: 'REQUESTED' }, select: { id: true, organizer: { select: { user: { select: { email: true } } } } } }),
    ]);
    if (!admin || !payout) throw new Error('payout is unavailable for this administrator');
    await transaction.payoutRequest.update({ where: { id: payout.id }, data: { status: 'REJECTED', reviewedByProfileId: admin.id, reviewedAt: now, reviewReason: reason.trim() } });
    await transaction.auditLog.create({ data: { actorProfileId: admin.id, action: 'PAYOUT_REJECTED', targetType: 'PAYOUT_REQUEST', targetId: payout.id, details: { reason: reason.trim() } } });
    await transaction.notificationJob.create({
      data: { type: 'PAYOUT_DECISION', recipientEmail: payout.organizer.user.email, idempotencyKey: `payout:${payout.id}:rejected` },
    });
  });
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export async function getAdministrationSummary({
  database,
  adminProfileId,
}: {
  database: PrismaClient;
  adminProfileId: string;
}): Promise<{
  paidOrderCount: number;
  totalPaidKobo: number;
  platformFeeRevenueKobo: number;
  refundLiabilityKobo: number;
  payoutLiabilityKobo: number;
}> {
  const admin = await database.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
  if (!admin) throw new Error('administrator access is unavailable');
  const [orders, refunds, payouts] = await Promise.all([
    database.order.findMany({ where: { status: 'PAID' }, select: { totalKobo: true, platformFeeKobo: true } }),
    database.refundRequest.findMany({ where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } }, select: { totalRefundKobo: true } }),
    database.payoutRequest.findMany({ where: { status: { in: ['REQUESTED', 'APPROVED'] } }, select: { requestedAmountKobo: true } }),
  ]);
  return {
    paidOrderCount: orders.length,
    totalPaidKobo: orders.reduce((total, order) => total + order.totalKobo, 0),
    platformFeeRevenueKobo: orders.reduce((total, order) => total + order.platformFeeKobo, 0),
    refundLiabilityKobo: refunds.reduce((total, refund) => total + refund.totalRefundKobo, 0),
    payoutLiabilityKobo: payouts.reduce((total, payout) => total + payout.requestedAmountKobo, 0),
  };
}

export async function listAdministrationEvents({ database, adminProfileId, state }: { database: PrismaClient; adminProfileId: string; state?: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED' }) {
  await requireActiveAdministrator(database, adminProfileId);
  return database.event.findMany({
    where: state ? { status: state } : undefined,
    select: { id: true, title: true, slug: true, status: true, featured: true, startAt: true, endAt: true, organizer: { select: { id: true, user: { select: { name: true, email: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAdministrationProfiles({ database, adminProfileId, query }: { database: PrismaClient; adminProfileId: string; query?: string }) {
  await requireActiveAdministrator(database, adminProfileId);
  const text = query?.trim();
  return database.applicationProfile.findMany({
    where: text ? { OR: [{ user: { name: { contains: text, mode: 'insensitive' } } }, { user: { email: { contains: text, mode: 'insensitive' } } }] } : undefined,
    select: { id: true, role: true, status: true, blockedAt: true, blockedByProfileId: true, blockReason: true, createdAt: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAdministrationOrders({ database, adminProfileId, query }: { database: PrismaClient; adminProfileId: string; query?: string }) {
  await requireActiveAdministrator(database, adminProfileId);
  const text = query?.trim();
  return database.order.findMany({
    where: text ? { OR: [{ reference: { contains: text, mode: 'insensitive' } }, { buyerEmail: { contains: text, mode: 'insensitive' } }, { paymentAttempts: { some: { reference: { contains: text, mode: 'insensitive' } } } }] } : undefined,
    select: { id: true, reference: true, buyerName: true, buyerEmail: true, status: true, totalKobo: true, createdAt: true, event: { select: { id: true, title: true } }, paymentAttempts: { select: { id: true, reference: true, status: true, expectedAmountKobo: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAdministrationRefundRequests({ database, adminProfileId }: { database: PrismaClient; adminProfileId: string }) {
  await requireActiveAdministrator(database, adminProfileId);
  return database.refundRequest.findMany({
    select: { id: true, status: true, ticketRefundKobo: true, platformFeeRefundKobo: true, totalRefundKobo: true, reason: true, requestedAt: true, reviewReason: true, gatewayRefundReference: true, gatewayStatus: true, processedAt: true, organizer: { select: { id: true, user: { select: { name: true, email: true } } } }, event: { select: { id: true, title: true } }, order: { select: { id: true, reference: true } } },
    orderBy: { requestedAt: 'desc' },
  });
}

export async function listAdministrationPayoutRequests({ database, adminProfileId }: { database: PrismaClient; adminProfileId: string }) {
  await requireActiveAdministrator(database, adminProfileId);
  return database.payoutRequest.findMany({
    select: { id: true, status: true, requestedAmountKobo: true, calculatedPayableKobo: true, requestedAt: true, reviewReason: true, transferReference: true, transferDate: true, paidAt: true, organizer: { select: { id: true, user: { select: { name: true, email: true } } } }, event: { select: { id: true, title: true } } },
    orderBy: { requestedAt: 'desc' },
  });
}

export async function pageAdministrationEvents({ database, adminProfileId, state, page, pageSize, skip }: { database: PrismaClient; adminProfileId: string; state?: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED'; page: number; pageSize: number; skip: number }) {
  await requireActiveAdministrator(database, adminProfileId);
  const where = state ? { status: state } : undefined;
  const select = { id: true, title: true, slug: true, status: true, featured: true, startAt: true, endAt: true, organizer: { select: { id: true, user: { select: { name: true, email: true } } } } } as const;
  const [items, total] = await database.$transaction([database.event.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip, take: pageSize }), database.event.count({ where })]);
  return { items, page, pageSize, total };
}

export async function pageAdministrationProfiles({ database, adminProfileId, query, page, pageSize, skip }: { database: PrismaClient; adminProfileId: string; query?: string; page: number; pageSize: number; skip: number }) {
  await requireActiveAdministrator(database, adminProfileId);
  const text = query?.trim();
  const where = text ? { OR: [{ user: { name: { contains: text, mode: 'insensitive' as const } } }, { user: { email: { contains: text, mode: 'insensitive' as const } } }] } : undefined;
  const select = { id: true, role: true, status: true, blockedAt: true, blockedByProfileId: true, blockReason: true, createdAt: true, user: { select: { name: true, email: true } } } as const;
  const [items, total] = await database.$transaction([database.applicationProfile.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip, take: pageSize }), database.applicationProfile.count({ where })]);
  return { items, page, pageSize, total };
}

export async function pageAdministrationOrders({ database, adminProfileId, query, status, page, pageSize, skip }: { database: PrismaClient; adminProfileId: string; query?: string; status?: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'PAID_NEEDS_RESOLUTION'; page: number; pageSize: number; skip: number }) {
  await requireActiveAdministrator(database, adminProfileId);
  const text = query?.trim();
  const where = { ...(status ? { status } : {}), ...(text ? { OR: [{ reference: { contains: text, mode: 'insensitive' as const } }, { buyerEmail: { contains: text, mode: 'insensitive' as const } }, { paymentAttempts: { some: { reference: { contains: text, mode: 'insensitive' as const } } } }] } : {}) };
  const select = { id: true, reference: true, buyerName: true, buyerEmail: true, status: true, totalKobo: true, createdAt: true, event: { select: { id: true, title: true } }, paymentAttempts: { select: { id: true, reference: true, status: true, expectedAmountKobo: true } } } as const;
  const [items, total] = await database.$transaction([database.order.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip, take: pageSize }), database.order.count({ where })]);
  return { items, page, pageSize, total };
}

export async function pageAdministrationRefundRequests({ database, adminProfileId, page, pageSize, skip, status }: { database: PrismaClient; adminProfileId: string; page: number; pageSize: number; skip: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'CANCELLED' }) {
  await requireActiveAdministrator(database, adminProfileId);
  const select = { id: true, status: true, ticketRefundKobo: true, platformFeeRefundKobo: true, totalRefundKobo: true, reason: true, requestedAt: true, reviewReason: true, gatewayRefundReference: true, gatewayStatus: true, processedAt: true, organizer: { select: { id: true, user: { select: { name: true, email: true } } } }, event: { select: { id: true, title: true } }, order: { select: { id: true, reference: true } } } as const;
  const where = status ? { status } : undefined;
  const [items, total] = await database.$transaction([database.refundRequest.findMany({ where, select, orderBy: { requestedAt: 'desc' }, skip, take: pageSize }), database.refundRequest.count({ where })]);
  return { items, page, pageSize, total };
}

export async function pageAdministrationPayoutRequests({ database, adminProfileId, page, pageSize, skip, status }: { database: PrismaClient; adminProfileId: string; page: number; pageSize: number; skip: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED' }) {
  await requireActiveAdministrator(database, adminProfileId);
  const select = { id: true, status: true, requestedAmountKobo: true, calculatedPayableKobo: true, requestedAt: true, reviewReason: true, transferReference: true, transferDate: true, paidAt: true, organizer: { select: { id: true, user: { select: { name: true, email: true } } } }, event: { select: { id: true, title: true } } } as const;
  const where = status ? { status } : undefined;
  const [items, total] = await database.$transaction([database.payoutRequest.findMany({ where, select, orderBy: { requestedAt: 'desc' }, skip, take: pageSize }), database.payoutRequest.count({ where })]);
  return { items, page, pageSize, total };
}

export async function getActivePlatformFeeRule({ database, adminProfileId, now }: { database: PrismaClient; adminProfileId: string; now: Date }) {
  await requireActiveAdministrator(database, adminProfileId);
  return database.platformFeeRule.findFirst({
    where: { activeFrom: { lte: now }, OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
    select: { id: true, version: true, mode: true, percentageBasisPoints: true, fixedAmountKobo: true, appliesToFreeOrder: true, activeFrom: true, activeUntil: true },
    orderBy: { version: 'desc' },
  });
}

async function requireActiveAdministrator(database: PrismaClient, adminProfileId: string): Promise<void> {
  const admin = await database.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
  if (!admin) throw new Error('administrator access is unavailable');
}
