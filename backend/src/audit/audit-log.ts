import { UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

export async function pageAuditLogs({
  database,
  profileId,
  role,
  page,
  pageSize,
}: {
  database: PrismaClient;
  profileId: string;
  role: 'ADMIN' | 'ORGANIZER';
  page: number;
  pageSize: number;
}): Promise<{ items: Array<{ id: string; action: string; targetType: string; targetId: string; details: unknown; createdAt: Date }>; page: number; pageSize: number; total: number }> {
  const profile = await database.applicationProfile.findFirst({ where: { id: profileId, status: 'ACTIVE', ...profileRoleFilter(role) }, select: { id: true } });
  if (!profile) throw new UnauthorizedException('active account access is required');
  const where = role === 'ADMIN' ? {} : { actorProfileId: profile.id };
  const [items, total] = await Promise.all([
    database.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, action: true, targetType: true, targetId: true, details: true, createdAt: true } }),
    database.auditLog.count({ where }),
  ]);
  return { items, page, pageSize, total };
}
