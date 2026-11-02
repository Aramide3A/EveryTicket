import type { PrismaClient } from '../generated/prisma/client.js';

export async function findLatestInitializedPaymentReference({
  database,
  orderReference,
}: {
  database: PrismaClient;
  orderReference: string;
}): Promise<string | null> {
  const order = await database.order.findUnique({
    where: { reference: orderReference },
    select: { paymentAttempts: { where: { status: 'INITIALIZED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { reference: true } } },
  });
  return order?.paymentAttempts[0]?.reference ?? null;
}
