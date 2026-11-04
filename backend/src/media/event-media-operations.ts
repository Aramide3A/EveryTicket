import type { PrismaClient } from '../generated/prisma/client.js';
import { profileRoleFilter } from '../identity/current-profile.js';

export async function createEventMediaUploadIntent({
  database,
  organizerProfileId,
  eventId,
  contentType,
  contentLength,
  createUpload,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  contentType: string;
  contentLength: number;
  createUpload: (input: { eventId: string; contentType: string; contentLength: number }) => Promise<{ objectKey: string; uploadUrl: string; publicUrl: string }>;
  now: Date;
}): Promise<{ mediaId: string; uploadUrl: string; publicUrl: string }> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const upload = await createUpload({ eventId, contentType, contentLength });
  if (!upload.objectKey.startsWith(`events/${eventId}/media/`)) throw new Error('media object key is invalid');
  const media = await database.eventMedia.create({
    data: { eventId, objectKey: upload.objectKey, publicUrl: upload.publicUrl, contentType, contentLength, expiresAt: new Date(now.getTime() + 15 * 60_000) },
    select: { id: true },
  });
  return { mediaId: media.id, uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl };
}

export async function completeEventMediaUpload({
  database,
  organizerProfileId,
  eventId,
  mediaId,
  verifyUploadedObject,
  now,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  mediaId: string;
  verifyUploadedObject: (input: { objectKey: string; contentType: string; contentLength: number }) => Promise<boolean>;
  now: Date;
}): Promise<void> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const media = await database.eventMedia.findFirst({ where: { id: mediaId, eventId, status: 'PENDING', expiresAt: { gt: now } }, select: { id: true, objectKey: true, contentType: true, contentLength: true } });
  if (!media || !(await verifyUploadedObject(media))) throw new Error('media upload is unavailable');
  await database.eventMedia.update({ where: { id: media.id }, data: { status: 'READY', completedAt: now } });
}

export async function listOwnedEventMedia({
  database,
  organizerProfileId,
  eventId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
}): Promise<Array<{ id: string; publicUrl: string; contentType: string; contentLength: number; status: string; position: number; isCover: boolean; expiresAt: Date; completedAt: Date | null }>> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const items = await database.eventMedia.findMany({
    where: { eventId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, publicUrl: true, contentType: true, contentLength: true, status: true, position: true, isCover: true, expiresAt: true, completedAt: true },
  });
  return items.sort((first, second) => Number(second.status === 'READY') - Number(first.status === 'READY'));
}

export async function reorderEventMedia({
  database,
  organizerProfileId,
  eventId,
  mediaIds,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  mediaIds: string[];
}): Promise<void> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const ready = await database.eventMedia.findMany({ where: { eventId, status: 'READY' }, select: { id: true } });
  if (mediaIds.length !== ready.length || new Set(mediaIds).size !== mediaIds.length || ready.some(({ id }) => !mediaIds.includes(id))) {
    throw new Error('media order must contain every ready item once');
  }
  await database.$transaction(mediaIds.map((id, position) => database.eventMedia.update({ where: { id }, data: { position } })));
}

export async function setEventCover({
  database,
  organizerProfileId,
  eventId,
  mediaId,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  mediaId: string;
}): Promise<void> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  await database.$transaction(async (transaction) => {
    const media = await transaction.eventMedia.findFirst({ where: { id: mediaId, eventId, status: 'READY' }, select: { id: true } });
    if (!media) throw new Error('ready media is unavailable');
    await transaction.eventMedia.updateMany({ where: { eventId, isCover: true }, data: { isCover: false } });
    await transaction.eventMedia.update({ where: { id: media.id }, data: { isCover: true } });
  }, { isolationLevel: 'Serializable' });
}

export async function removeEventMedia({
  database,
  organizerProfileId,
  eventId,
  mediaId,
  deleteObject,
}: {
  database: PrismaClient;
  organizerProfileId: string;
  eventId: string;
  mediaId: string;
  deleteObject: (objectKey: string) => Promise<void>;
}): Promise<void> {
  await requireOwnedEvent(database, organizerProfileId, eventId);
  const media = await database.eventMedia.findFirst({ where: { id: mediaId, eventId }, select: { id: true, objectKey: true } });
  if (!media) throw new Error('media is unavailable to this organizer');
  await deleteObject(media.objectKey);
  await database.eventMedia.delete({ where: { id: media.id } });
}

export async function removeExpiredMediaUploads({
  database,
  deleteObject,
  now,
}: {
  database: PrismaClient;
  deleteObject: (objectKey: string) => Promise<void>;
  now: Date;
}): Promise<number> {
  const media = await database.eventMedia.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, select: { id: true, objectKey: true } });
  for (const item of media) {
    await deleteObject(item.objectKey);
    await database.eventMedia.delete({ where: { id: item.id } });
  }
  return media.length;
}

async function requireOwnedEvent(database: PrismaClient, organizerProfileId: string, eventId: string): Promise<void> {
  const event = await database.event.findFirst({ where: { id: eventId, organizerProfileId, organizer: { status: 'ACTIVE', ...profileRoleFilter('ORGANIZER') } }, select: { id: true } });
  if (!event) throw new Error('event is unavailable to this organizer');
}
