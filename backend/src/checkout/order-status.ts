import type { PrismaClient } from '../generated/prisma/client.js';

export async function getCustomerOrderStatus({
  database,
  orderReference,
}: {
  database: PrismaClient;
  orderReference: string;
}): Promise<{ reference: string; status: string; holdExpiresAt: Date; paidAt: Date | null } | null> {
  return database.order.findFirst({
    where: { reference: orderReference },
    select: { reference: true, status: true, holdExpiresAt: true, paidAt: true },
  });
}
