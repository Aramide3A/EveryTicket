import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

type Category = { id: string; name: string; slug: string };

export async function listEventCategoriesForAdmin({
  database,
  adminProfileId,
}: {
  database: PrismaClient;
  adminProfileId: string;
}): Promise<Category[]> {
  await requireAdministrator(database, adminProfileId);
  return database.eventCategory.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } });
}

export async function createEventCategory({
  database,
  adminProfileId,
  name,
  slug,
}: {
  database: PrismaClient;
  adminProfileId: string;
  name: string;
  slug: string;
}): Promise<Category> {
  const normalized = normalizeCategory({ name, slug });
  return database.$transaction(async (transaction) => {
    await requireAdministrator(transaction, adminProfileId);
    const existing = await transaction.eventCategory.findFirst({
      where: { OR: [{ name: normalized.name }, { slug: normalized.slug }] },
      select: { id: true },
    });
    if (existing) throw new ConflictException('category name or slug already exists');
    const category = await transaction.eventCategory.create({ data: normalized, select: { id: true, name: true, slug: true } });
    await transaction.auditLog.create({
      data: { actorProfileId: adminProfileId, action: 'EVENT_CATEGORY_CREATED', targetType: 'EVENT_CATEGORY', targetId: category.id, details: normalized },
    });
    return category;
  });
}

export async function updateEventCategory({
  database,
  adminProfileId,
  categoryId,
  name,
  slug,
}: {
  database: PrismaClient;
  adminProfileId: string;
  categoryId: string;
  name?: string;
  slug?: string;
}): Promise<Category> {
  return database.$transaction(async (transaction) => {
    await requireAdministrator(transaction, adminProfileId);
    const category = await transaction.eventCategory.findFirst({ where: { id: categoryId }, select: { id: true, name: true, slug: true } });
    if (!category) throw new NotFoundException('category was not found');
    const normalized = normalizeCategory({ name: name ?? category.name, slug: slug ?? category.slug });
    const duplicate = await transaction.eventCategory.findFirst({
      where: { id: { not: category.id }, OR: [{ name: normalized.name }, { slug: normalized.slug }] },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('category name or slug already exists');
    const updated = await transaction.eventCategory.update({ where: { id: category.id }, data: normalized, select: { id: true, name: true, slug: true } });
    await transaction.auditLog.create({
      data: { actorProfileId: adminProfileId, action: 'EVENT_CATEGORY_UPDATED', targetType: 'EVENT_CATEGORY', targetId: category.id, details: { before: { name: category.name, slug: category.slug }, after: normalized } },
    });
    return updated;
  });
}

function normalizeCategory({ name, slug }: { name: string; slug: string }): Omit<Category, 'id'> {
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const normalizedSlug = slug.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalizedName || !normalizedSlug) throw new ConflictException('category name and slug are required');
  return { name: normalizedName, slug: normalizedSlug };
}

async function requireAdministrator(database: Pick<PrismaClient, 'applicationProfile'>, profileId: string): Promise<void> {
  const admin = await database.applicationProfile.findFirst({ where: { id: profileId, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
  if (!admin) throw new UnauthorizedException('administrator access is unavailable');
}
