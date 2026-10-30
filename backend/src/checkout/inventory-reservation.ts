import type { PrismaClient } from '../generated/prisma/client.js';

export type ReserveInventoryHoldInput = {
  database: PrismaClient;
  orderId: string;
  ticketTypeId: string;
  quantity: number;
  now: Date;
  expiresAt: Date;
};

export async function reserveInventoryHold({
  database,
  orderId,
  ticketTypeId,
  quantity,
  now,
  expiresAt,
}: ReserveInventoryHoldInput): Promise<{ id: string; quantity: number }> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive safe integer');
  }
  if (expiresAt <= now) {
    throw new RangeError('hold expiry must be in the future');
  }

  return database.$transaction(async (transaction) => {
    const ticketTypes = await transaction.$queryRaw<{ capacity: number }[]>`
      SELECT ticket_type.capacity
      FROM ticket_type
      JOIN "order" ON "order".id = ${orderId}
      WHERE ticket_type.id = ${ticketTypeId}
        AND ticket_type."eventId" = "order"."eventId"
        AND "order".status = 'PENDING_PAYMENT'
      FOR UPDATE OF ticket_type
    `;

    const ticketType = ticketTypes[0];
    if (!ticketType) {
      throw new Error('pending order and ticket type must belong to the same event');
    }

    const heldQuantities = await transaction.$queryRaw<{ quantity: number }[]>`
      SELECT COALESCE(SUM(quantity), 0)::INTEGER AS quantity
      FROM inventory_hold
      WHERE "ticketTypeId" = ${ticketTypeId}
        AND "expiresAt" > ${now}
    `;
    const heldQuantity = heldQuantities[0]?.quantity ?? 0;

    if (heldQuantity + quantity > ticketType.capacity) {
      throw new Error('inventory is unavailable');
    }

    return transaction.inventoryHold.create({
      data: { orderId, ticketTypeId, quantity, expiresAt },
      select: { id: true, quantity: true },
    });
  });
}
