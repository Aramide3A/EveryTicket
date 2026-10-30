import type { PrismaClient } from '../generated/prisma/client.js';

export async function getCustomerOrderStatus({
  database,
  customerProfileId,
  orderReference,
}: {
  database: PrismaClient;
  customerProfileId: string;
  orderReference: string;
}): Promise<{ reference: string; status: string; holdExpiresAt: Date; paidAt: Date | null } | null> {
  return database.order.findFirst({
    where: { reference: orderReference, customerProfileId },
    select: { reference: true, status: true, holdExpiresAt: true, paidAt: true },
  });
}
