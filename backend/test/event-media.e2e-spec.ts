import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type EventMediaOperations = {
  createEventMediaUploadIntent(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
    contentType: string;
    contentLength: number;
    createUpload: (input: { eventId: string; contentType: string; contentLength: number }) => Promise<{ objectKey: string; uploadUrl: string; publicUrl: string }>;
    now: Date;
  }): Promise<{ mediaId: string; uploadUrl: string; publicUrl: string }>;
  completeEventMediaUpload(input: {
    database: ReturnType<typeof createDatabaseClient>;
    organizerProfileId: string;
    eventId: string;
    mediaId: string;
    verifyUploadedObject: (input: { objectKey: string; contentType: string; contentLength: number }) => Promise<boolean>;
    now: Date;
  }): Promise<void>;
};

async function loadEventMediaOperations(): Promise<EventMediaOperations | undefined> {
  try {
    return await import('../src/media/event-media-operations.js') as EventMediaOperations;
  } catch {
    return undefined;
  }
}

describe('event media upload lifecycle', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.eventId) await client.$executeRaw`DELETE FROM event_media WHERE "eventId" = ${ids.eventId}`;
      if (ids.eventId) await client.$executeRaw`DELETE FROM event WHERE id = ${ids.eventId}`;
      if (ids.categoryId) await client.$executeRaw`DELETE FROM event_category WHERE id = ${ids.categoryId}`;
      if (ids.userId) await client.$executeRaw`DELETE FROM auth_user WHERE id = ${ids.userId}`;
      await client.$disconnect();
    }
    client = undefined;
    Object.keys(ids).forEach((key) => delete ids[key]);
  });

  it('records an organizer-owned public image only after R2 confirms the upload', async () => {
    const media = await loadEventMediaOperations();
    const databaseUrl = process.env.DATABASE_URL;
    expect(media).toBeDefined();
    if (!media || !databaseUrl) throw new Error('event media operations are unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    const intent = await media.createEventMediaUploadIntent({
      database: client,
      organizerProfileId: ids.profileId,
      eventId: ids.eventId,
      contentType: 'image/png',
      contentLength: 1024,
      createUpload: async ({ eventId }) => ({ objectKey: `events/${eventId}/media/upload.png`, uploadUrl: 'https://upload.example.test', publicUrl: `https://media.example.test/events/${eventId}/media/upload.png` }),
      now: new Date('2032-01-01T10:00:00.000Z'),
    });
    await expect(client.$queryRaw<Array<{ status: string }>>`SELECT status::text FROM event_media WHERE id = ${intent.mediaId}`).resolves.toEqual([{ status: 'PENDING' }]);

    await media.completeEventMediaUpload({
      database: client,
      organizerProfileId: ids.profileId,
      eventId: ids.eventId,
      mediaId: intent.mediaId,
      verifyUploadedObject: async (input) => input.objectKey.endsWith('upload.png') && input.contentType === 'image/png' && input.contentLength === 1024,
      now: new Date('2032-01-01T10:01:00.000Z'),
    });
    await expect(client.$queryRaw<Array<{ status: string; publicUrl: string }>>`SELECT status::text, "publicUrl" FROM event_media WHERE id = ${intent.mediaId}`).resolves.toEqual([{ status: 'READY', publicUrl: intent.publicUrl }]);
  });
});

async function createFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { userId: randomUUID(), profileId: randomUUID(), categoryId: randomUUID(), eventId: randomUUID() });
  await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${ids.userId}, 'Organizer', ${`${ids.userId}@example.test`}, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${ids.profileId}, ${ids.userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, ${`Media ${ids.categoryId}`}, ${`media-${ids.categoryId}`}, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "publishedAt", "createdAt", "updatedAt") VALUES (${ids.eventId}, ${ids.profileId}, ${ids.categoryId}, 'Media Event', ${`media-event-${ids.eventId}`}, 'Description', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-02-01T10:00:00.000Z', '2032-02-01T12:00:00.000Z', 'PUBLISHED', NOW(), NOW(), NOW())`;
}
