import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

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
    if (order.tickets.length !== ticketIds.length) throw new Error('selected tickets are unavailable for this order');
    if (ticketRefundKobo > order.tickets.reduce((total, ticket) => total + ticket.priceKobo, 0) || platformFeeRefundKobo > order.platformFeeKobo) {
      throw new RangeError('refund exceeds the selected ticket value');
    }
    const existing = await transaction.refundRequestTicket.findFirst({
      where: { ticketId: { in: ticketIds }, refundRequest: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'PROCESSED'] } } },
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
    return { id: payout.id, status: 'REQUESTED', requestedAmountKobo: payout.requestedAmountKobo, calculatedPayableKobo: payout.calculatedPayableKobo };
  });
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
