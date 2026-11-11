import type { PrismaClient } from '../generated/prisma/client.js';
import { expirePendingOrder } from './order-expiry.js';

export async function getCustomerOrderStatus({
  database,
  orderReference,
  now = new Date(),
}: {
  database: PrismaClient;
  orderReference: string;
  now?: Date;
}): Promise<{ reference: string; status: string; holdExpiresAt: Date; paidAt: Date | null } | null> {
  await expirePendingOrder({ database, orderReference, now });
  return database.order.findFirst({
    where: { reference: orderReference },
    select: { reference: true, status: true, holdExpiresAt: true, paidAt: true },
  });
}
