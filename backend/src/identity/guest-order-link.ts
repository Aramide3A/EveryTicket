import type { PrismaClient } from '../generated/prisma/client.js';

type VerifiedUser = { id: string; email: string; emailVerified: boolean };

export async function linkGuestOrdersForVerifiedUser({
  database,
  user,
  profileId,
}: {
  database: PrismaClient;
  user: VerifiedUser;
  profileId?: string;
}): Promise<number> {
  if (!user.emailVerified) return 0;
  const resolvedProfileId = profileId ?? (await database.applicationProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  }))?.id;
  if (!resolvedProfileId) return 0;
  const result = await database.order.updateMany({
    where: { customerProfileId: null, buyerEmail: user.email.trim().toLowerCase() },
    data: { customerProfileId: resolvedProfileId },
  });
  return result.count;
}
