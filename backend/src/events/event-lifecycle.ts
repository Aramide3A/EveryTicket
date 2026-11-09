import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

export async function cancelOwnedEvent({
  database,
  organizerProfileId,
  eventId,
  reason,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  const cancelledReason = reason.trim();
  if (!cancelledReason) throw new RangeError('cancellation reason is required');
  await database.$transaction(async (transaction) => {
    const event = await transaction.event.findFirst({
      where: { id: eventId, organizerProfileId, status: 'PUBLISHED', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
      select: { id: true },
    });
    if (!event) throw new Error('event is unavailable to this organizer');
    await transaction.inventoryHold.deleteMany({ where: { order: { eventId, status: 'PENDING_PAYMENT' } } });
    await transaction.order.updateMany({ where: { eventId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
    await transaction.ticket.updateMany({ where: { eventId, status: 'ACTIVE' }, data: { status: 'REVOKED' } });
    await transaction.guest.updateMany({ where: { guestList: { eventId }, credentialStatus: 'ACTIVE' }, data: { credentialStatus: 'REVOKED' } });
    await transaction.event.update({ where: { id: event.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelledReason } });
    await transaction.auditLog.create({ data: { actorProfileId: organizerProfileId, action: 'EVENT_CANCELLED', targetType: 'EVENT', targetId: event.id, details: { reason: cancelledReason } } });
  }, { isolationLevel: 'Serializable' });
}

export async function removeOwnedEvent({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<void> {
  await database.$transaction(async (transaction) => {
    const event = await transaction.event.findFirst({
      where: { id: eventId, organizerProfileId, status: 'DRAFT', organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } },
      select: { id: true, _count: { select: { orders: true, tickets: true, guestLists: true, checkIns: true, refundRequests: true, payoutRequests: true, media: true } } },
    });
    if (!event) throw new Error('event is unavailable to this organizer');
    if (Object.values(event._count).some((count) => count > 0)) throw new Error('event has operational or financial activity');
    await transaction.ticketType.deleteMany({ where: { eventId } });
    await transaction.auditLog.create({ data: { actorProfileId: organizerProfileId, action: 'EVENT_REMOVED', targetType: 'EVENT', targetId: event.id } });
    await transaction.event.delete({ where: { id: event.id } });
  }, { isolationLevel: 'Serializable' });
}
