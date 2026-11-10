import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ApplicationRole, PrismaClient } from '../generated/prisma/client.js';
import { profileHasRole, profileRoleFilter } from '../identity/current-profile.js';

type ManagedProfile = {
  id: string;
  role: ApplicationRole;
  roles: ApplicationRole[];
  status: 'ACTIVE' | 'BLOCKED';
};

export async function setProfileAdministrator({
  database,
  adminProfileId,
  profileId,
  enabled,
}: {
  database: PrismaClient;
  adminProfileId: string;
  profileId: string;
  enabled: boolean;
}): Promise<{ id: string; role: ApplicationRole; roles: ApplicationRole[] }> {
  if (profileId === adminProfileId) {
    throw new BadRequestException('administrators cannot change their own administrator access');
  }

  return database.$transaction(async (transaction) => {
    const administrator = await transaction.applicationProfile.findFirst({
      where: { id: adminProfileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') },
      select: { id: true },
    });
    if (!administrator) throw new UnauthorizedException('administrator access is unavailable');

    const target = await transaction.applicationProfile.findFirst({
      where: { id: profileId, status: 'ACTIVE' },
      select: { id: true, role: true, roles: true, status: true },
    }) as ManagedProfile | null;
    if (!target) throw new NotFoundException('account was not found');

    const currentlyAdministrator = profileHasRole(target, 'ADMIN');
    if (enabled && currentlyAdministrator) throw new ConflictException('account already has administrator access');
    if (!enabled && !currentlyAdministrator) throw new ConflictException('account does not have administrator access');

    if (!enabled) {
      const activeAdministratorCount = await transaction.applicationProfile.count({
        where: { status: 'ACTIVE', ...profileRoleFilter('ADMIN') },
      });
      if (activeAdministratorCount <= 1) {
        throw new BadRequestException('the final active administrator cannot be removed');
      }
    }

    const nextRoles = enabled
      ? uniqueRoles([...target.roles, target.role, 'ADMIN'])
      : uniqueRoles([...target.roles, target.role].filter((role) => role !== 'ADMIN'));
    if (!nextRoles.length) nextRoles.push('CUSTOMER');
    const nextRole = enabled ? 'ADMIN' : nextRoles.includes('ORGANIZER') ? 'ORGANIZER' : 'CUSTOMER';

    await transaction.applicationProfile.update({
      where: { id: target.id },
      data: { role: nextRole, roles: { set: nextRoles } },
    });
    await transaction.auditLog.create({
      data: {
        actorProfileId: administrator.id,
        action: enabled ? 'ACCOUNT_ADMIN_GRANTED' : 'ACCOUNT_ADMIN_REVOKED',
        targetType: 'APPLICATION_PROFILE',
        targetId: target.id,
        details: {
          before: { role: target.role, roles: target.roles },
          after: { role: nextRole, roles: nextRoles },
        },
      },
    });
    return { id: target.id, role: nextRole, roles: nextRoles };
  });
}

function uniqueRoles(roles: ApplicationRole[]): ApplicationRole[] {
  return [...new Set(roles)];
}
