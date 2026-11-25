import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

type Context = { database: PrismaClient; adminProfileId: string };
type ImageInput = { contentType: string; contentLength: number };
type Upload = { objectKey: string; uploadUrl: string; publicUrl: string };
type SlideInput = { eyebrow: string; headline: string; copy: string; ctaLabel: string; ctaHref: string };
const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

export async function requireCarouselAdministrator(database: Pick<PrismaClient, 'applicationProfile'>, id: string) {
  const admin = await database.applicationProfile.findFirst({ where: { id, status: 'ACTIVE', ...profileRoleFilter('ADMIN') }, select: { id: true } });
  if (!admin) throw new UnauthorizedException('administrator access is unavailable');
}

export async function listPublicCarouselImages(database: PrismaClient, createDownloadUrl?: (image: { objectKey: string }) => Promise<string>) {
  const images = await database.carouselImage.findMany({ where: { status: 'READY' }, orderBy, select: { id: true, objectKey: true, publicUrl: true, altText: true, eyebrow: true, headline: true, copy: true, ctaLabel: true, ctaHref: true } });
  return Promise.all(images.map(async ({ objectKey, ...image }) => ({
    ...image,
    publicUrl: createDownloadUrl ? await createDownloadUrl({ objectKey }) : image.publicUrl,
  })));
}

export async function listAdminCarouselImages({ database, adminProfileId }: Context) {
  await requireCarouselAdministrator(database, adminProfileId);
  return database.carouselImage.findMany({ where: { status: 'READY' }, orderBy, select: { id: true, publicUrl: true, altText: true, eyebrow: true, headline: true, copy: true, ctaLabel: true, ctaHref: true, contentType: true, contentLength: true, createdAt: true, completedAt: true } });
}

export async function createCarouselUploadIntent({ database, adminProfileId, altText, contentType, contentLength, createUpload, now, ...content }: Context & ImageInput & {
  altText: string; createUpload: (input: ImageInput) => Promise<Upload>; now: Date;
} & SlideInput) {
  await requireCarouselAdministrator(database, adminProfileId);
  const slide = readSlideInput(content);
  if (typeof altText !== 'string' || !altText.trim() || altText.trim().length > 300) throw new BadRequestException('altText must contain 1–300 characters');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new BadRequestException('image type is not supported');
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > 5 * 1024 * 1024) throw new BadRequestException('image size must be between 1 byte and 5 MiB');
  const upload = await createUpload({ contentType, contentLength });
  if (!/^carousel\/[^/]+\.(?:jpg|png|webp)$/.test(upload.objectKey)) throw new Error('carousel object key is invalid');
  const image = await database.carouselImage.create({ data: { objectKey: upload.objectKey, publicUrl: upload.publicUrl, altText: altText.trim(), ...slide, contentType, contentLength, expiresAt: new Date(now.getTime() + 15 * 60_000) }, select: { id: true } });
  return { imageId: image.id, uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl };
}

export async function updateCarouselSlide({ database, adminProfileId, imageId, ...content }: Context & { imageId: string } & SlideInput) {
  await requireCarouselAdministrator(database, adminProfileId);
  const updated = await database.carouselImage.updateMany({ where: { id: imageId, status: 'READY' }, data: readSlideInput(content) });
  if (!updated.count) throw new NotFoundException('carousel image was not found');
  await database.auditLog.create({ data: { actorProfileId: adminProfileId, action: 'CAROUSEL_SLIDE_UPDATED', targetType: 'CAROUSEL_IMAGE', targetId: imageId } });
}

function readSlideInput(input: SlideInput): SlideInput {
  return {
    eyebrow: readText(input.eyebrow, 'eyebrow', 80),
    headline: readText(input.headline, 'headline', 140),
    copy: readText(input.copy, 'copy', 360),
    ctaLabel: readText(input.ctaLabel, 'ctaLabel', 48),
    ctaHref: readCtaHref(input.ctaHref),
  };
}

function readText(value: string, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new BadRequestException(`${field} must contain 1–${maximum} characters`);
  return value.trim();
}

function readCtaHref(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2048) throw new BadRequestException('ctaHref is invalid');
  const href = value.trim();
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    if (new URL(href).protocol === 'https:') return href;
  } catch { /* validation below */ }
  throw new BadRequestException('ctaHref is invalid');
}

export async function completeCarouselUpload({ database, adminProfileId, imageId, verifyUploadedObject, now }: Context & {
  imageId: string; verifyUploadedObject: (image: ImageInput & { objectKey: string }) => Promise<boolean>; now: Date;
}) {
  await requireCarouselAdministrator(database, adminProfileId);
  const image = await database.carouselImage.findUnique({ where: { id: imageId } });
  if (!image || image.status === 'DELETING') throw new NotFoundException('carousel image is unavailable');
  if (image.status === 'READY') return;
  if (image.expiresAt <= now) throw new ConflictException('upload expired; select the image and upload again');
  if (!(await verifyUploadedObject(image))) throw new ConflictException('uploaded image is missing or does not match the upload intent');
  await database.$transaction(async (transaction) => {
    await requireCarouselAdministrator(transaction, adminProfileId);
    const updated = await transaction.carouselImage.updateMany({ where: { id: imageId, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'READY', completedAt: now } });
    if (updated.count) {
      await transaction.auditLog.create({ data: { actorProfileId: adminProfileId, action: 'CAROUSEL_IMAGE_PUBLISHED', targetType: 'CAROUSEL_IMAGE', targetId: imageId } });
    } else {
      const current = await transaction.carouselImage.findUnique({ where: { id: imageId } });
      if (current?.status !== 'READY') throw new ConflictException('carousel image is unavailable');
    }
  });
}

export async function removeCarouselImage({ database, adminProfileId, imageId, deleteObject }: Context & { imageId: string; deleteObject: (key: string) => Promise<void> }) {
  const image = await database.$transaction(async (transaction) => {
    await requireCarouselAdministrator(transaction, adminProfileId);
    const image = await transaction.carouselImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('carousel image was not found');
    const updated = await transaction.carouselImage.updateMany({ where: { id: imageId, status: { not: 'DELETING' } }, data: { status: 'DELETING' } });
    if (updated.count) await transaction.auditLog.create({ data: { actorProfileId: adminProfileId, action: 'CAROUSEL_IMAGE_REMOVED', targetType: 'CAROUSEL_IMAGE', targetId: imageId } });
    return image;
  });
  await deleteObject(image.objectKey);
  // Keep the tombstone until the upload window closes, so a late signed PUT is cleaned too.
}

export async function cleanupCarouselImages({ database, deleteObject, now }: { database: PrismaClient; deleteObject: (key: string) => Promise<void>; now: Date }) {
  await database.carouselImage.updateMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'DELETING' } });
  const images = await database.carouselImage.findMany({ where: { status: 'DELETING' } });
  const failures: unknown[] = [];
  for (const image of images) {
    try {
      await deleteObject(image.objectKey);
      if (image.expiresAt <= now) await database.carouselImage.deleteMany({ where: { id: image.id, status: 'DELETING' } });
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'carousel cleanup failed; deletions will be retried');
  return images.length;
}
