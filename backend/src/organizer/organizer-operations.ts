import type { PrismaClient } from '../generated/prisma/client.js';
import type { Page } from '../common/http/pagination.js';
import { profileRoleFilter } from '../identity/current-profile.js';

const ACTIVE_REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'PROCESSED'] as const;

export async function getOrganizerDashboard({
  database,
  organizerProfileId,
  eventId,
  now,
}: {
  database: PrismaClient;
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
}> {
  const event = await requireOwnedEvent(database, organizerProfileId, eventId);
  const [orders, ticketTypes, ticketCheckIns, guestCheckIns, refunds, payouts] = await Promise.all([
    database.order.findMany({ where: { eventId, status: 'PAID' }, select: { ticketSubtotalKobo: true, platformFeeKobo: true, totalKobo: true, paidAt: true } }),
    database.ticketType.findMany({
      where: { eventId },
      select: { id: true, name: true, capacity: true, tickets: { where: { order: { status: 'PAID' } }, select: { priceKobo: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    database.checkIn.count({ where: { eventId, ticketId: { not: null } } }),
    database.checkIn.count({ where: { eventId, guestId: { not: null } } }),
    database.refundRequest.findMany({
      where: { eventId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'PROCESSED'] } },
      select: { ticketRefundKobo: true, totalRefundKobo: true },
    }),
    database.payoutRequest.findMany({
      where: { eventId, status: { in: ['REQUESTED', 'APPROVED', 'PAID'] } },
      select: { requestedAmountKobo: true },
    }),
  ]);
  const ticketSubtotalKobo = orders.reduce((total, order) => total + order.ticketSubtotalKobo, 0);
  const platformFeeKobo = orders.reduce((total, order) => total + order.platformFeeKobo, 0);
  const totalPaidKobo = orders.reduce((total, order) => total + order.totalKobo, 0);
  const salesByTicketType = ticketTypes.map((ticketType) => ({
    ticketTypeId: ticketType.id,
    name: ticketType.name,
    quantity: ticketType.tickets.length,
    ticketSubtotalKobo: ticketType.tickets.reduce((total, ticket) => total + ticket.priceKobo, 0),
  }));
  const confirmedTicketsSold = salesByTicketType.reduce((total, ticketType) => total + ticketType.quantity, 0);
  const remainingCapacity = ticketTypes.reduce((total, ticketType) => total + Math.max(ticketType.capacity - ticketType.tickets.length, 0), 0);
  const refundsRecordedKobo = refunds.reduce((total, refund) => total + refund.totalRefundKobo, 0);
  const reservedTicketRefundKobo = refunds.reduce((total, refund) => total + refund.ticketRefundKobo, 0);
  const reservedPayoutKobo = payouts.reduce((total, payout) => total + payout.requestedAmountKobo, 0);
  const payableKobo = Math.max(ticketSubtotalKobo - reservedTicketRefundKobo - reservedPayoutKobo, 0);
  const trend = new Map<string, { ticketSubtotalKobo: number; totalPaidKobo: number }>();
  for (const order of orders) {
    if (!order.paidAt) continue;
    const date = order.paidAt.toISOString().slice(0, 10);
    const current = trend.get(date) ?? { ticketSubtotalKobo: 0, totalPaidKobo: 0 };
    current.ticketSubtotalKobo += order.ticketSubtotalKobo;
    current.totalPaidKobo += order.totalKobo;
    trend.set(date, current);
  }
  return {
    confirmedTicketsSold,
    remainingCapacity,
    ticketSubtotalKobo,
    platformFeeKobo,
    totalPaidKobo,
    refundsRecordedKobo,
    payableKobo,
    payoutEligible: event.endAt <= now,
    ticketCheckIns,
    guestCheckIns,
    salesByTicketType,
    salesTrend: [...trend.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([date, values]) => ({ date, ...values })),
  };
}

export async function listOrganizerAttendees({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<Array<{ kind: 'TICKET' | 'GUEST'; attendeeId: string; name: string; email: string; ticketTypeName: string | null; responseStatus: string | null; credentialStatus: string; checkedIn: boolean }>> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const [tickets, guests] = await Promise.all([
    database.ticket.findMany({
      where: { eventId, order: { status: 'PAID' } },
      select: { id: true, holderName: true, holderEmail: true, ticketTypeName: true, status: true, checkIn: { select: { id: true } } },
      orderBy: { issuedAt: 'asc' },
    }),
    database.guest.findMany({
      where: { guestList: { eventId } },
      select: { id: true, name: true, email: true, responseStatus: true, credentialStatus: true, checkIn: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return [
    ...tickets.map((ticket) => ({
      kind: 'TICKET' as const,
      attendeeId: ticket.id,
      name: ticket.holderName,
      email: ticket.holderEmail,
      ticketTypeName: ticket.ticketTypeName,
      responseStatus: null,
      credentialStatus: ticket.status,
      checkedIn: Boolean(ticket.checkIn),
    })),
    ...guests.map((guest) => ({
      kind: 'GUEST' as const,
      attendeeId: guest.id,
      name: guest.name,
      email: guest.email,
      ticketTypeName: null,
      responseStatus: guest.responseStatus,
      credentialStatus: guest.credentialStatus,
      checkedIn: Boolean(guest.checkIn),
    })),
  ];
}

export async function exportOrganizerAttendeesCsv(input: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<string> {
  const attendees = await listOrganizerAttendees(input);
  return [
    'kind,name,email,ticketType,responseStatus,credentialStatus,attendance',
    ...attendees.map((attendee) => [
      attendee.kind,
      attendee.name,
      attendee.email,
      attendee.ticketTypeName ?? '',
      attendee.responseStatus ?? '',
      attendee.credentialStatus,
      attendee.checkedIn ? 'checked-in' : 'not-checked-in',
    ].map(csvCell).join(',')),
    '',
  ].join('\r\n');
}

export async function listOrganizerCheckIns({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<Array<{ id: string; kind: 'TICKET' | 'GUEST'; attendeeId: string; name: string; checkedInAt: Date; checkedInBy: { id: string; name: string } }>> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const checkIns = await database.checkIn.findMany({
    where: { eventId },
    orderBy: [{ checkedInAt: 'desc' }, { id: 'desc' }],
    select: { id: true, checkedInAt: true, ticket: { select: { id: true, holderName: true } }, guest: { select: { id: true, name: true } }, checkedInBy: { select: { id: true, user: { select: { name: true } } } } },
  });
  const history: Array<{ id: string; kind: 'TICKET' | 'GUEST'; attendeeId: string; name: string; checkedInAt: Date; checkedInBy: { id: string; name: string } }> = [];
  for (const checkIn of checkIns) {
    const checkedInBy = { id: checkIn.checkedInBy.id, name: checkIn.checkedInBy.user.name };
    if (checkIn.ticket) history.push({ id: checkIn.id, kind: 'TICKET', attendeeId: checkIn.ticket.id, name: checkIn.ticket.holderName, checkedInAt: checkIn.checkedInAt, checkedInBy });
    else if (checkIn.guest) history.push({ id: checkIn.id, kind: 'GUEST', attendeeId: checkIn.guest.id, name: checkIn.guest.name, checkedInAt: checkIn.checkedInAt, checkedInBy });
  }
  return history;
}

export async function exportOrganizerCheckInsCsv(input: { database: PrismaClient; organizerProfileId: string; eventId: string }): Promise<string> {
  const history = await listOrganizerCheckIns(input);
  return [
    'kind,name,checkedInAt,checkedInBy',
    ...history.map((checkIn) => [checkIn.kind, checkIn.name, checkIn.checkedInAt.toISOString(), checkIn.checkedInBy.name].map(csvCell).join(',')),
    '',
  ].join('\r\n');
}

export async function getOrganizerOrderRefundInputs({
  database,
  organizerProfileId,
  orderId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  orderId: string;
}): Promise<{ id: string; reference: string; buyerName: string; buyerEmail: string; status: string; maxPlatformFeeRefundKobo: number; tickets: Array<{ id: string; holderName: string; holderEmail: string; ticketTypeName: string; priceKobo: number; eligible: boolean; maxTicketRefundKobo: number }> }> {
  const order = await database.order.findFirst({
    where: { id: orderId, status: 'PAID', event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } } },
    select: {
      id: true,
      reference: true,
      buyerName: true,
      buyerEmail: true,
      status: true,
      platformFeeKobo: true,
      refundRequests: { where: { status: { in: [...ACTIVE_REFUND_STATUSES] } }, select: { platformFeeRefundKobo: true } },
      tickets: { orderBy: { issuedAt: 'asc' }, select: { id: true, holderName: true, holderEmail: true, ticketTypeName: true, priceKobo: true, refundRequestTickets: { where: { refundRequest: { status: { in: [...ACTIVE_REFUND_STATUSES] } } }, select: { ticketId: true } } } },
    },
  });
  if (!order) throw new Error('order is unavailable to this organizer');
  const reservedPlatformFeeKobo = order.refundRequests.reduce((total, refund) => total + refund.platformFeeRefundKobo, 0);
  return {
    id: order.id,
    reference: order.reference,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    status: order.status,
    maxPlatformFeeRefundKobo: Math.max(0, order.platformFeeKobo - reservedPlatformFeeKobo),
    tickets: order.tickets.map(({ refundRequestTickets, ...ticket }) => ({ ...ticket, eligible: refundRequestTickets.length === 0, maxTicketRefundKobo: refundRequestTickets.length === 0 ? ticket.priceKobo : 0 })),
  };
}

export async function createRefundRequest({
  database,
  organizerProfileId,
  orderId,
  ticketIds,
  ticketRefundKobo,
  platformFeeRefundKobo,
  reason,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  orderId: string;
  ticketIds: string[];
  ticketRefundKobo: number;
  platformFeeRefundKobo: number;
  reason: string;
  now: Date;
}): Promise<{ id: string; status: 'REQUESTED'; totalRefundKobo: number }> {
  if (!reason.trim() || !ticketIds.length || new Set(ticketIds).size !== ticketIds.length) throw new RangeError('reason and unique ticket IDs are required');
  if (!Number.isInteger(ticketRefundKobo) || !Number.isInteger(platformFeeRefundKobo) || ticketRefundKobo < 0 || platformFeeRefundKobo < 0 || ticketRefundKobo + platformFeeRefundKobo < 1) {
    throw new RangeError('refund amounts are invalid');
  }
  return database.$transaction(async (transaction) => {
    const order = await transaction.order.findFirst({
      where: {
        id: orderId,
        status: 'PAID',
        event: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
      },
      select: { eventId: true, platformFeeKobo: true, tickets: { where: { id: { in: ticketIds } }, select: { id: true, priceKobo: true } } },
    });
    if (!order) throw new Error('order is unavailable to this organizer');
    await transaction.$queryRaw`SELECT id FROM "order" WHERE id = ${orderId} FOR UPDATE`;
    if (order.tickets.length !== ticketIds.length) throw new Error('selected tickets are unavailable for this order');
    const reservedPlatformFeeKobo = await transaction.refundRequest.aggregate({ where: { orderId, status: { in: [...ACTIVE_REFUND_STATUSES] } }, _sum: { platformFeeRefundKobo: true } });
    if (ticketRefundKobo > order.tickets.reduce((total, ticket) => total + ticket.priceKobo, 0) || platformFeeRefundKobo > order.platformFeeKobo - (reservedPlatformFeeKobo._sum.platformFeeRefundKobo ?? 0)) {
      throw new RangeError('refund exceeds the selected ticket value');
    }
    const existing = await transaction.refundRequestTicket.findFirst({
      where: { ticketId: { in: ticketIds }, refundRequest: { status: { in: [...ACTIVE_REFUND_STATUSES] } } },
      select: { ticketId: true },
    });
    if (existing) throw new Error('a refund already reserves a selected ticket');
    const totalRefundKobo = ticketRefundKobo + platformFeeRefundKobo;
    const refund = await transaction.refundRequest.create({
      data: {
        organizerProfileId,
        eventId: order.eventId,
        orderId,
        ticketRefundKobo,
        platformFeeRefundKobo,
        totalRefundKobo,
        reason: reason.trim(),
        requestedAt: now,
        tickets: { create: ticketIds.map((ticketId) => ({ ticketId })) },
      },
      select: { id: true, status: true, totalRefundKobo: true },
    });
    await transaction.auditLog.create({ data: { actorProfileId: organizerProfileId, action: 'REFUND_REQUEST_CREATED', targetType: 'REFUND_REQUEST', targetId: refund.id, details: { orderId, ticketIds } } });
    return { id: refund.id, status: 'REQUESTED', totalRefundKobo: refund.totalRefundKobo };
  });
}

export async function createPayoutRequest({
  database,
  organizerProfileId,
  eventId,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  now: Date;
}): Promise<{ id: string; status: 'REQUESTED'; requestedAmountKobo: number; calculatedPayableKobo: number }> {
  return database.$transaction(async (transaction) => {
    const event = await transaction.event.findFirst({
      where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
      select: { endAt: true },
    });
    if (!event) throw new Error('event is unavailable to this organizer');
    if (event.endAt > now) throw new Error('payout is unavailable before the event ends');
    await transaction.$queryRaw`SELECT id FROM event WHERE id = ${eventId} FOR UPDATE`;
    const [orders, refunds, payouts] = await Promise.all([
      transaction.order.findMany({ where: { eventId, status: 'PAID' }, select: { ticketSubtotalKobo: true } }),
      transaction.refundRequest.findMany({
        where: { eventId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'PROCESSED'] } },
        select: { ticketRefundKobo: true },
      }),
      transaction.payoutRequest.findMany({
        where: { eventId, status: { in: ['REQUESTED', 'APPROVED', 'PAID'] } },
        select: { status: true, requestedAmountKobo: true },
      }),
    ]);
    const ticketSubtotalKobo = orders.reduce((total, order) => total + order.ticketSubtotalKobo, 0);
    const reservedRefundKobo = refunds.reduce((total, refund) => total + refund.ticketRefundKobo, 0);
    const priorPaidKobo = payouts.filter((payout) => payout.status === 'PAID').reduce((total, payout) => total + payout.requestedAmountKobo, 0);
    const reservedPayoutKobo = payouts.filter((payout) => payout.status !== 'PAID').reduce((total, payout) => total + payout.requestedAmountKobo, 0);
    const calculatedPayableKobo = ticketSubtotalKobo - reservedRefundKobo - priorPaidKobo - reservedPayoutKobo;
    if (calculatedPayableKobo < 1) throw new Error('no payout is available for this event');
    const payout = await transaction.payoutRequest.create({
      data: {
        organizerProfileId,
        eventId,
        ticketSubtotalKobo,
        reservedRefundKobo,
        priorPaidKobo,
        requestedAmountKobo: calculatedPayableKobo,
        calculatedPayableKobo,
        requestedAt: now,
      },
      select: { id: true, requestedAmountKobo: true, calculatedPayableKobo: true },
    });
    await transaction.auditLog.create({ data: { actorProfileId: organizerProfileId, action: 'PAYOUT_REQUEST_CREATED', targetType: 'PAYOUT_REQUEST', targetId: payout.id, details: { eventId, requestedAmountKobo: payout.requestedAmountKobo } } });
    return { id: payout.id, status: 'REQUESTED', requestedAmountKobo: payout.requestedAmountKobo, calculatedPayableKobo: payout.calculatedPayableKobo };
  });
}

export async function getOrganizerRefundRequest({
  database,
  organizerProfileId,
  refundRequestId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  refundRequestId: string;
}): Promise<{ id: string; orderId: string; reason: string; status: string; ticketRefundKobo: number; platformFeeRefundKobo: number; totalRefundKobo: number; maxTicketRefundKobo: number; maxPlatformFeeRefundKobo: number; permittedActions: Array<'UPDATE' | 'CANCEL'>; tickets: Array<{ id: string; holderName: string; ticketTypeName: string; priceKobo: number }> }> {
  const refund = await database.refundRequest.findFirst({
    where: { id: refundRequestId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: {
      id: true,
      orderId: true,
      reason: true,
      status: true,
      ticketRefundKobo: true,
      platformFeeRefundKobo: true,
      totalRefundKobo: true,
      order: { select: { platformFeeKobo: true, refundRequests: { where: { id: { not: refundRequestId }, status: { in: [...ACTIVE_REFUND_STATUSES] } }, select: { platformFeeRefundKobo: true } } } },
      tickets: { select: { ticket: { select: { id: true, holderName: true, ticketTypeName: true, priceKobo: true } } } },
    },
  });
  if (!refund) throw new Error('refund request is unavailable to this organizer');
  const tickets = refund.tickets.map(({ ticket }) => ticket);
  const reservedPlatformFeeKobo = refund.order.refundRequests.reduce((total, request) => total + request.platformFeeRefundKobo, 0);
  return {
    id: refund.id,
    orderId: refund.orderId,
    reason: refund.reason,
    status: refund.status,
    ticketRefundKobo: refund.ticketRefundKobo,
    platformFeeRefundKobo: refund.platformFeeRefundKobo,
    totalRefundKobo: refund.totalRefundKobo,
    maxTicketRefundKobo: tickets.reduce((total, ticket) => total + ticket.priceKobo, 0),
    maxPlatformFeeRefundKobo: Math.max(0, refund.order.platformFeeKobo - reservedPlatformFeeKobo),
    permittedActions: refund.status === 'REQUESTED' ? ['UPDATE', 'CANCEL'] : [],
    tickets,
  };
}

export async function updateRefundRequest({
  database,
  organizerProfileId,
  refundRequestId,
  ticketRefundKobo,
  platformFeeRefundKobo,
  reason,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  refundRequestId: string;
  ticketRefundKobo: number;
  platformFeeRefundKobo: number;
  reason: string;
}): Promise<{ totalRefundKobo: number }> {
  if (!reason.trim() || !Number.isInteger(ticketRefundKobo) || !Number.isInteger(platformFeeRefundKobo) || ticketRefundKobo < 0 || platformFeeRefundKobo < 0 || ticketRefundKobo + platformFeeRefundKobo < 1) {
    throw new RangeError('refund values are invalid');
  }
  return database.$transaction(async (transaction) => {
    const refund = await transaction.refundRequest.findFirst({
      where: { id: refundRequestId, organizerProfileId, status: 'REQUESTED', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
      select: { order: { select: { platformFeeKobo: true } }, tickets: { select: { ticket: { select: { priceKobo: true } } } } },
    });
    if (!refund) throw new Error('refund request is unavailable to this organizer');
    if (ticketRefundKobo > refund.tickets.reduce((total, item) => total + item.ticket.priceKobo, 0) || platformFeeRefundKobo > refund.order.platformFeeKobo) {
      throw new RangeError('refund exceeds the selected ticket value');
    }
    const totalRefundKobo = ticketRefundKobo + platformFeeRefundKobo;
    await transaction.refundRequest.update({
      where: { id: refundRequestId },
      data: { ticketRefundKobo, platformFeeRefundKobo, totalRefundKobo, reason: reason.trim() },
    });
    await transaction.auditLog.create({ data: { actorProfileId: organizerProfileId, action: 'REFUND_REQUEST_UPDATED', targetType: 'REFUND_REQUEST', targetId: refundRequestId, details: { ticketRefundKobo, platformFeeRefundKobo } } });
    return { totalRefundKobo };
  });
}

export async function cancelRefundRequest({
  database,
  organizerProfileId,
  refundRequestId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  refundRequestId: string;
}): Promise<void> {
  const updated = await database.refundRequest.updateMany({
    where: { id: refundRequestId, organizerProfileId, status: 'REQUESTED', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    data: { status: 'CANCELLED' },
  });
  if (updated.count !== 1) throw new Error('refund request is unavailable to this organizer');
  await database.auditLog.create({ data: { actorProfileId: organizerProfileId, action: 'REFUND_REQUEST_CANCELLED', targetType: 'REFUND_REQUEST', targetId: refundRequestId } });
}

export async function listOrganizerOrders({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<Array<{ id: string; reference: string; buyerName: string; buyerEmail: string; ticketSubtotalKobo: number; platformFeeKobo: number; totalKobo: number; status: string; paidAt: Date | null; createdAt: Date }>> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  return database.order.findMany({
    where: { eventId },
    select: { id: true, reference: true, buyerName: true, buyerEmail: true, ticketSubtotalKobo: true, platformFeeKobo: true, totalKobo: true, status: true, paidAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function pageOrganizerOrders({ database, organizerProfileId, eventId, page, pageSize, skip, query, status }: { database: PrismaClient; organizerProfileId: string; eventId: string; page: number; pageSize: number; skip: number; query?: string; status?: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'PAID_NEEDS_RESOLUTION' }): Promise<Page<Awaited<ReturnType<typeof listOrganizerOrders>>[number]>> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const text = query?.trim();
  const where = { eventId, ...(status ? { status } : {}), ...(text ? { OR: [{ reference: { contains: text, mode: 'insensitive' as const } }, { buyerName: { contains: text, mode: 'insensitive' as const } }, { buyerEmail: { contains: text, mode: 'insensitive' as const } }] } : {}) };
  const select = { id: true, reference: true, buyerName: true, buyerEmail: true, ticketSubtotalKobo: true, platformFeeKobo: true, totalKobo: true, status: true, paidAt: true, createdAt: true } as const;
  const [items, total] = await database.$transaction([
    database.order.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    database.order.count({ where }),
  ]);
  return { items, page, pageSize, total };
}

type OrganizerAttendee = Awaited<ReturnType<typeof listOrganizerAttendees>>[number];

export async function pageOrganizerAttendees({ database, organizerProfileId, eventId, page, pageSize, skip, query, kind }: { database: PrismaClient; organizerProfileId: string; eventId: string; page: number; pageSize: number; skip: number; query?: string; kind?: 'TICKET' | 'GUEST' }): Promise<Page<OrganizerAttendee>> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  type Row = { kind: 'TICKET' | 'GUEST'; attendeeId: string; name: string; email: string; ticketTypeName: string | null; responseStatus: string | null; credentialStatus: string; checkedIn: boolean };
  const text = query?.trim() || null;
  const selectedKind = kind ?? null;
  const [items, totals] = await Promise.all([
    database.$queryRaw<Row[]>`
      SELECT kind, "attendeeId", name, email, "ticketTypeName", "responseStatus", "credentialStatus", "checkedIn" FROM (
        SELECT 'TICKET'::text AS kind, t.id AS "attendeeId", t."holderName" AS name, t."holderEmail" AS email,
          t."ticketTypeName" AS "ticketTypeName", NULL::text AS "responseStatus", t.status::text AS "credentialStatus",
          (ci.id IS NOT NULL) AS "checkedIn", t."issuedAt" AS "sortAt"
        FROM ticket t JOIN "order" o ON o.id = t."orderId" LEFT JOIN check_in ci ON ci."ticketId" = t.id
        WHERE t."eventId" = ${eventId} AND o.status = 'PAID'
        UNION ALL
        SELECT 'GUEST'::text AS kind, g.id AS "attendeeId", g.name, g.email, NULL::text AS "ticketTypeName",
          g."responseStatus"::text AS "responseStatus", g."credentialStatus"::text AS "credentialStatus",
          (ci.id IS NOT NULL) AS "checkedIn", g."createdAt" AS "sortAt"
        FROM guest g JOIN guest_list gl ON gl.id = g."guestListId" LEFT JOIN check_in ci ON ci."guestId" = g.id
        WHERE gl."eventId" = ${eventId}
      ) attendee
      WHERE (${selectedKind}::text IS NULL OR kind = ${selectedKind})
        AND (${text}::text IS NULL OR name ILIKE '%' || ${text} || '%' OR email ILIKE '%' || ${text} || '%')
      ORDER BY "sortAt" ASC, "attendeeId" ASC LIMIT ${pageSize} OFFSET ${skip}`,
    database.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT 'TICKET'::text AS kind, t."holderName" AS name, t."holderEmail" AS email
        FROM ticket t JOIN "order" o ON o.id = t."orderId" WHERE t."eventId" = ${eventId} AND o.status = 'PAID'
        UNION ALL
        SELECT 'GUEST'::text AS kind, g.name, g.email FROM guest g JOIN guest_list gl ON gl.id = g."guestListId" WHERE gl."eventId" = ${eventId}
      ) attendee
      WHERE (${selectedKind}::text IS NULL OR kind = ${selectedKind})
        AND (${text}::text IS NULL OR name ILIKE '%' || ${text} || '%' OR email ILIKE '%' || ${text} || '%')`,
  ]);
  return { items, page, pageSize, total: totals[0]?.total ?? 0 };
}

export async function listOrganizerRefundRequests({
  database,
  organizerProfileId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
}): Promise<Array<{ id: string; eventId: string; orderId: string; ticketRefundKobo: number; platformFeeRefundKobo: number; totalRefundKobo: number; status: string; requestedAt: Date }>> {
  return database.refundRequest.findMany({
    where: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true, eventId: true, orderId: true, ticketRefundKobo: true, platformFeeRefundKobo: true, totalRefundKobo: true, status: true, requestedAt: true },
    orderBy: { requestedAt: 'desc' },
  });
}

export async function pageOrganizerRefundRequests({ database, organizerProfileId, page, pageSize, skip, status }: { database: PrismaClient; organizerProfileId: string; page: number; pageSize: number; skip: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'CANCELLED' }) {
  const where = { organizerProfileId, ...(status ? { status } : {}), organizer: { status: 'ACTIVE' as const, ...profileRoleFilter('ORGANIZER') } };
  const select = { id: true, eventId: true, orderId: true, ticketRefundKobo: true, platformFeeRefundKobo: true, totalRefundKobo: true, status: true, requestedAt: true } as const;
  const [items, total] = await database.$transaction([database.refundRequest.findMany({ where, select, orderBy: { requestedAt: 'desc' }, skip, take: pageSize }), database.refundRequest.count({ where })]);
  return { items, page, pageSize, total };
}

export async function listOrganizerPayoutRequests({
  database,
  organizerProfileId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
}): Promise<Array<{ id: string; eventId: string; requestedAmountKobo: number; calculatedPayableKobo: number; status: string; requestedAt: Date }>> {
  return database.payoutRequest.findMany({
    where: { organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true, eventId: true, requestedAmountKobo: true, calculatedPayableKobo: true, status: true, requestedAt: true },
    orderBy: { requestedAt: 'desc' },
  });
}

export async function pageOrganizerPayoutRequests({ database, organizerProfileId, page, pageSize, skip, status }: { database: PrismaClient; organizerProfileId: string; page: number; pageSize: number; skip: number; status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED' }) {
  const where = { organizerProfileId, ...(status ? { status } : {}), organizer: { status: 'ACTIVE' as const, ...profileRoleFilter('ORGANIZER') } };
  const select = { id: true, eventId: true, requestedAmountKobo: true, calculatedPayableKobo: true, status: true, requestedAt: true } as const;
  const [items, total] = await database.$transaction([database.payoutRequest.findMany({ where, select, orderBy: { requestedAt: 'desc' }, skip, take: pageSize }), database.payoutRequest.count({ where })]);
  return { items, page, pageSize, total };
}

export async function getOrganizerPayoutRequest({
  database,
  organizerProfileId,
  payoutRequestId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  payoutRequestId: string;
}): Promise<{ id: string; event: { id: string; title: string }; status: string; requestedAmountKobo: number; calculatedPayableKobo: number; requestedAt: Date; reviewReason: string | null; transferReference: string | null; transferDate: Date | null; paidAt: Date | null; receiptAvailable: boolean }> {
  const payout = await database.payoutRequest.findFirst({
    where: { id: payoutRequestId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { id: true, status: true, requestedAmountKobo: true, calculatedPayableKobo: true, requestedAt: true, reviewReason: true, transferReference: true, transferDate: true, paidAt: true, event: { select: { id: true, title: true } } },
  });
  if (!payout) throw new Error('payout request is unavailable to this organizer');
  return { ...payout, receiptAvailable: payout.status === 'PAID' && Boolean(payout.transferReference && payout.transferDate && payout.paidAt) };
}

export async function exportOrganizerPayoutReceiptCsv(input: { database: PrismaClient; organizerProfileId: string; payoutRequestId: string }): Promise<string> {
  const payout = await getOrganizerPayoutRequest(input);
  if (!payout.receiptAvailable || !payout.transferReference || !payout.transferDate || !payout.paidAt) throw new Error('payout receipt is unavailable');
  return [
    'payoutId,eventId,eventTitle,status,requestedAmountKobo,transferReference,transferDate,paidAt',
    [payout.id, payout.event.id, payout.event.title, payout.status, payout.requestedAmountKobo.toString(), payout.transferReference, payout.transferDate.toISOString(), payout.paidAt.toISOString()].map(csvCell).join(','),
    '',
  ].join('\r\n');
}

async function requireOwnedEvent(database: PrismaClient, organizerProfileId: string, eventId: string): Promise<{ endAt: Date }> {
  const event = await database.event.findFirst({
    where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
    select: { endAt: true },
  });
  if (!event) throw new Error('event is unavailable to this organizer');
  return event;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
