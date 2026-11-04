import type { PrismaClient } from '../generated/prisma/client.js';

export async function upgradeProfileToOrganizer({ database, profileId }: { database: PrismaClient; profileId: string }): Promise<{ role: 'ORGANIZER'; roles: Array<'CUSTOMER' | 'ORGANIZER' | 'ADMIN'> }> {
  const profile = await database.applicationProfile.findFirst({ where: { id: profileId, status: 'ACTIVE', roles: { has: 'CUSTOMER' } }, select: { roles: true } });
  if (!profile) throw new Error('profile is unavailable for organizer upgrade');
  const roles = [...new Set([...profile.roles, 'CUSTOMER' as const, 'ORGANIZER' as const])];
  await database.applicationProfile.update({ where: { id: profileId }, data: { role: 'ORGANIZER', roles: { set: roles } } });
  return { role: 'ORGANIZER', roles };
}
