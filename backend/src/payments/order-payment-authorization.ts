import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

export async function authorizeOrderPayment({
  database,
  orderReference,
  customerProfileId,
  guestAccessToken,
}: {
  database: Pick<PrismaClient, 'order'>;
  orderReference: string;
  customerProfileId: string | null;
  guestAccessToken: string;
}): Promise<boolean> {
  const guestWhere = guestAccessToken
    ? {
        customerProfileId: null,
        guestAccessTokenDigest: createHash('sha256')
          .update(guestAccessToken)
          .digest('hex'),
      }
    : null;
  if (!customerProfileId && !guestWhere) return false;

  const ownership =
    customerProfileId && guestWhere
      ? { OR: [{ customerProfileId }, guestWhere] }
      : customerProfileId
        ? { customerProfileId }
        : guestWhere;
  const order = await database.order.findFirst({
    where: { reference: orderReference, ...ownership },
    select: { id: true },
  });
  return Boolean(order);
}
