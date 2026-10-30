import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ApplicationRole } from '../generated/prisma/client.js';
import { createDatabaseClient } from '../persistence/prisma-client.js';

export async function requireActiveProfile(
  request: Request,
  role?: ApplicationRole,
): Promise<{ id: string; role: 'CUSTOMER' | 'ORGANIZER' | 'ADMIN'; roles: ApplicationRole[] }> {
  if (!request.headers.cookie) {
    throw new UnauthorizedException('authentication is required');
  }
  const { auth } = await import('./auth.js');
  const { fromNodeHeaders } = await import('better-auth/node');
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    throw new UnauthorizedException('authentication is required');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ServiceUnavailableException('identity is not configured');
  }
  const database = createDatabaseClient(databaseUrl);
  try {
    const profile = await database.applicationProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, role: true, roles: true, status: true },
    });
    if (!profile || profile.status !== 'ACTIVE' || (role && !profileHasRole(profile, role))) {
      throw new UnauthorizedException('active account access is required');
    }
    return profile;
  } finally {
    await database.$disconnect();
  }
}

export function profileHasRole(
  profile: { role: ApplicationRole; roles: ApplicationRole[] },
  requiredRole: ApplicationRole,
): boolean {
  return profile.role === requiredRole || profile.roles.includes(requiredRole);
}

export function profileRoleFilter(requiredRole: ApplicationRole) {
  return {
    OR: [
      { role: requiredRole },
      { roles: { has: requiredRole } },
    ],
  };
}
