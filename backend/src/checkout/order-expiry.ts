import type { PrismaClient } from '../generated/prisma/client.js';

export async function expirePendingOrder({ database, orderReference, now }: { database: PrismaClient; orderReference: string; now: Date }): Promise<boolean> {
  return database.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ id: string; status: string; holdExpiresAt: Date }>>`
      SELECT id, status::text, "holdExpiresAt" FROM "order" WHERE reference = ${orderReference} FOR UPDATE
    `;
    const order = rows[0];
    if (!order || order.status !== 'PENDING_PAYMENT' || order.holdExpiresAt > now) return false;
    await transaction.inventoryHold.deleteMany({ where: { orderId: order.id } });
    await transaction.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
    return true;
  });
}

export async function expirePendingOrders({ database, now, limit = 100 }: { database: PrismaClient; now: Date; limit?: number }): Promise<{ checked: number; expired: number }> {
  const candidates = await database.order.findMany({
    where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } },
    select: { reference: true },
    orderBy: { holdExpiresAt: 'asc' },
    take: limit,
  });
  let expired = 0;
  for (const candidate of candidates) {
    if (await expirePendingOrder({ database, orderReference: candidate.reference, now })) expired += 1;
  }
  return { checked: candidates.length, expired };
}
