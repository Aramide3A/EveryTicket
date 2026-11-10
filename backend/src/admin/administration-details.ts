import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

const identitySelect = { id: true, role: true, roles: true, user: { select: { name: true, email: true } } } as const;

// Explicit allowlists keep credentials, storage keys and provider payloads out of administration responses.
export const eventsDetailSelect = {
  id: true,
  title: true,
  slug: true,
  status: true,
  featured: true,
  startAt: true,
  endAt: true,
  organizer: { select: identitySelect },
  description: true,
  city: true,
  state: true,
  venue: true,
  address: true,
  timeZone: true,
  category: { select: { id: true, name: true, slug: true } },
  publishedAt: true,
  suspendedAt: true,
  suspendedReason: true,
  cancelledAt: true,
  cancelledReason: true,
  createdAt: true,
  updatedAt: true,
  ticketTypes: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, description: true, priceKobo: true, capacity: true, salesStartAt: true, salesEndAt: true, isActive: true, maxPerOrder: true, createdAt: true, updatedAt: true } },
  media: { where: { status: 'READY' }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, publicUrl: true, contentType: true, contentLength: true, status: true, position: true, isCover: true, completedAt: true, createdAt: true, updatedAt: true } },
} as const satisfies Prisma.EventSelect;

export const profilesDetailSelect = {
  id: true,
  role: true,
  status: true,
  blockedAt: true,
  blockedByProfileId: true,
  blockReason: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
  roles: true,
  updatedAt: true,
  blockedBy: { select: identitySelect },
} as const satisfies Prisma.ApplicationProfileSelect;

export const ordersDetailSelect = {
  id: true,
  reference: true,
  buyerName: true,
  buyerEmail: true,
  status: true,
  totalKobo: true,
  createdAt: true,
  event: { select: { id: true, title: true } },
  paymentAttempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, reference: true, status: true, expectedAmountKobo: true, currency: true, initializedAt: true, verifiedAt: true, createdAt: true, failureDetail: true } },
  buyerPhone: true,
  currency: true,
  ticketSubtotalKobo: true,
  platformFeeKobo: true,
  paystackFeeKobo: true,
  paystackChargeKobo: true,
  platformFeeRuleId: true,
  platformFeeRuleVersion: true,
  platformFeeMode: true,
  platformFeePercentageBasisPoints: true,
  platformFeeFixedAmountKobo: true,
  paidAt: true,
  holdExpiresAt: true,
  customerProfile: { select: identitySelect },
  lines: { orderBy: { id: 'asc' }, select: { id: true, ticketTypeId: true, ticketTypeName: true, unitPriceKobo: true, quantity: true, createdAt: true } },
} as const satisfies Prisma.OrderSelect;

export const refundRequestsDetailSelect = {
  id: true,
  status: true,
  ticketRefundKobo: true,
  platformFeeRefundKobo: true,
  totalRefundKobo: true,
  reason: true,
  requestedAt: true,
  reviewReason: true,
  gatewayRefundReference: true,
  gatewayStatus: true,
  processedAt: true,
  organizer: { select: identitySelect },
  event: { select: { id: true, title: true } },
  order: { select: { id: true, reference: true, buyerName: true, buyerEmail: true, buyerPhone: true, currency: true, ticketSubtotalKobo: true, platformFeeKobo: true, paystackFeeKobo: true, paystackChargeKobo: true, totalKobo: true } },
  reviewedByProfileId: true,
  reviewedAt: true,
  reviewer: { select: identitySelect },
  createdAt: true,
  updatedAt: true,
  tickets: { orderBy: { ticketId: 'asc' }, select: { ticketId: true, ticket: { select: { id: true, holderName: true, ticketTypeName: true, priceKobo: true, status: true } } } },
} as const satisfies Prisma.RefundRequestSelect;

export const payoutRequestsDetailSelect = {
  id: true,
  status: true,
  requestedAmountKobo: true,
  calculatedPayableKobo: true,
  requestedAt: true,
  reviewReason: true,
  transferReference: true,
  transferDate: true,
  paidAt: true,
  organizer: { select: identitySelect },
  event: { select: { id: true, title: true } },
  ticketSubtotalKobo: true,
  reservedRefundKobo: true,
  priorPaidKobo: true,
  reviewedByProfileId: true,
  reviewedAt: true,
  reviewer: { select: identitySelect },
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PayoutRequestSelect;

export const feeRuleDetailSelect = { id: true, version: true, mode: true, percentageBasisPoints: true, fixedAmountKobo: true, appliesToFreeOrder: true, activeFrom: true, activeUntil: true, createdAt: true, changedByProfileId: true, changedBy: { select: identitySelect } } as const satisfies Prisma.PlatformFeeRuleSelect;
export const auditDetailSelect = { id: true, action: true, targetType: true, targetId: true, details: true, createdAt: true, actorProfileId: true, actor: { select: identitySelect } } as const satisfies Prisma.AuditLogSelect;

type DetailInput = { database: PrismaClient; adminProfileId: string; id: string };
async function authorize(database: PrismaClient, adminProfileId: string) {
  const admin = await database.applicationProfile.findFirst({ where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
  if (!admin) throw new UnauthorizedException('active administrator access is required');
}
function requireRecord<T>(record: T | null): T {
  if (!record) throw new NotFoundException('record not found');
  return record;
}

export async function getAdministrationEvent({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.event.findUnique({ where: { id }, select: eventsDetailSelect }));
}

export async function getAdministrationProfile({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.applicationProfile.findUnique({ where: { id }, select: profilesDetailSelect }));
}

export async function getAdministrationOrder({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.order.findUnique({ where: { id }, select: ordersDetailSelect }));
}

export async function getAdministrationRefund({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.refundRequest.findUnique({ where: { id }, select: refundRequestsDetailSelect }));
}

export async function getAdministrationPayout({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.payoutRequest.findUnique({ where: { id }, select: payoutRequestsDetailSelect }));
}

export async function getAdministrationFeeRule({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.platformFeeRule.findUnique({ where: { id }, select: feeRuleDetailSelect }));
}

export async function getAdministrationAuditLog({ database, adminProfileId, id }: DetailInput) {
  await authorize(database, adminProfileId);
  return requireRecord(await database.auditLog.findUnique({ where: { id }, select: auditDetailSelect }));
}
