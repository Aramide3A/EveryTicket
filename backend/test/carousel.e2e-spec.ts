import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApi } from '../src/api.js';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';
import { cleanupCarouselImages, completeCarouselUpload, createCarouselUploadIntent, listAdminCarouselImages, listPublicCarouselImages, removeCarouselImage } from '../src/media/carousel-operations.js';
import { createR2ObjectStore } from '../src/worker/r2-object-store.js';

// Requires an isolated, migrated DATABASE_URL; no live R2 credentials are used.
describe('carousel lifecycle and authorization', () => {
  let database: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let adminProfileId: string;
  const users: string[] = [];
  const cookies: Record<string, string[]> = {};
  const profiles: Record<string, string> = {};
  const imageIds: string[] = [];
  const now = new Date('2032-01-01T00:00:00Z');
  const verified = async () => true;
  const config = { endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'test', accessKeyId: 'test', secretAccessKey: 'test', publicMediaUrl: 'https://media.example.test' };
  const createUpload = async () => { const objectKey = `carousel/${randomUUID()}.png`; return { objectKey, uploadUrl: `https://upload.example.test/${objectKey}`, publicUrl: `${config.publicMediaUrl}/${objectKey}` }; };
  const context = () => ({ database, adminProfileId });
  async function intent(overrides: Record<string, unknown> = {}) {
    const result = await createCarouselUploadIntent({ ...context(), altText: '  Concert artwork  ', contentType: 'image/png', contentLength: 1024, createUpload, now, ...overrides });
    imageIds.push(result.imageId);
    return result.imageId;
  }
  beforeAll(async () => {
    database = createDatabaseClient(process.env.DATABASE_URL!);
    app = await createApi();
    for (const role of ['ADMIN', 'CUSTOMER', 'ORGANIZER', 'BLOCKED'] as const) {
      const email = `${randomUUID()}@example.test`;
      const signed = await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ name: role, email, password: 'password1234' }).expect(200);
      users.push(signed.body.user.id);
      const profile = await database.applicationProfile.findUniqueOrThrow({ where: { userId: signed.body.user.id } });
      profiles[role] = profile.id;
      await database.applicationProfile.update({ where: { id: profile.id }, data: { role: role === 'BLOCKED' ? 'ADMIN' : role, roles: [role === 'BLOCKED' ? 'ADMIN' : role], status: role === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE' } });
      await database.auth_user.update({ where: { id: signed.body.user.id }, data: { emailVerified: true } });
      const login = await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({ email, password: 'password1234' }).expect(200);
      const cookie = login.headers['set-cookie'];
      cookies[role] = Array.isArray(cookie) ? cookie : [cookie];
    }
    adminProfileId = profiles.ADMIN;
  }, 60000);
  afterEach(async () => {
    await database.carouselImage.deleteMany({ where: { id: { in: imageIds } } });
    imageIds.length = 0;
  });
  afterAll(async () => {
    await database.auditLog.deleteMany({ where: { actorProfileId: { in: Object.values(profiles) } } });
    await database.applicationProfile.deleteMany({ where: { userId: { in: users } } });
    await database.auth_user.deleteMany({ where: { id: { in: users } } });
    await database.$disconnect();
    await app.close();
    const { authDatabase } = await import('../src/identity/auth.js');
    await authDatabase.$disconnect();
  });

  it('requires active administrator sessions on every management endpoint and checks operations independently', async () => {
    const server = app.getHttpServer();
    const publicResponse = await request(server).get('/api/v1/carousel/images').expect(200);
    expect(publicResponse.body).toEqual({ items: expect.any(Array) });
    expect(publicResponse.headers['cache-control']).toBe('no-store');
    await request(server).get('/api/v1/admin/carousel/images').set('Cookie', cookies.ADMIN).expect(200);
    // Invalid data reaches operation validation for an administrator, without touching R2.
    await request(server).post('/api/v1/admin/carousel/images/upload-intent').set('Cookie', cookies.ADMIN).send({}).expect(400);
    for (const role of ['ANONYMOUS', 'CUSTOMER', 'ORGANIZER', 'BLOCKED']) {
      for (const [method, path] of [['get', ''], ['post', '/upload-intent'], ['post', '/missing/complete'], ['delete', '/missing']] as const) {
        const operation = request(server)[method](`/api/v1/admin/carousel/images${path}`);
        if (cookies[role]) operation.set('Cookie', cookies[role]);
        await operation.expect(401);
      }
      const denied = { database, adminProfileId: profiles[role] ?? 'missing' };
      await expect(listAdminCarouselImages(denied)).rejects.toThrow('administrator');
      await expect(createCarouselUploadIntent({ ...denied, altText: 'a', contentType: 'image/png', contentLength: 1, createUpload, now })).rejects.toThrow('administrator');
      await expect(completeCarouselUpload({ ...denied, imageId: 'missing', now, verifyUploadedObject: verified })).rejects.toThrow('administrator');
      await expect(removeCarouselImage({ ...denied, imageId: 'missing', deleteObject: async () => undefined })).rejects.toThrow('administrator');
    }
  });

  it('validates image type, size and trimmed alt text before asking R2 for an upload', async () => {
    for (const fields of [{ altText: ' ' }, { altText: 'a'.repeat(301) }, { contentType: 'image/svg+xml' }, { contentLength: 0 }, { contentLength: 5242881 }, { contentLength: 1.5 }]) {
      await expect(intent(fields)).rejects.toThrow();
    }
    const id = await intent();
    expect((await database.carouselImage.findUniqueOrThrow({ where: { id } })).altText).toBe('Concert artwork');
    await expect(intent({ createUpload: async () => ({ objectKey: 'events/other/media/image.png', uploadUrl: 'url', publicUrl: 'url' }) })).rejects.toThrow('object key');
  });

  it('excludes pending uploads, verifies before publication, completes idempotently and orders by creation time and ID', async () => {
    const second = await intent();
    const first = await intent();
    expect(await listPublicCarouselImages(database)).not.toContainEqual(expect.objectContaining({ id: first }));
    await expect(completeCarouselUpload({ ...context(), imageId: first, now, verifyUploadedObject: async () => false })).rejects.toThrow('missing or does not match');
    await completeCarouselUpload({ ...context(), imageId: first, now, verifyUploadedObject: verified });
    await completeCarouselUpload({ ...context(), imageId: first, now, verifyUploadedObject: async () => { throw new Error('must not reverify ready image'); } });
    await completeCarouselUpload({ ...context(), imageId: second, now, verifyUploadedObject: verified });
    const timestamp = new Date('2030-01-01');
    await database.carouselImage.updateMany({ where: { id: { in: [first, second] } }, data: { createdAt: timestamp } });
    expect((await listPublicCarouselImages(database)).filter((image) => imageIds.includes(image.id)).map((image) => image.id)).toEqual([first, second].sort());
    expect(await database.auditLog.count({ where: { targetId: first, action: 'CAROUSEL_IMAGE_PUBLISHED' } })).toBe(1);
    const publicResponse = await request(app.getHttpServer()).get('/api/v1/carousel/images').expect(200);
    expect(publicResponse.body.items.find((image: { id: string }) => image.id === first)).toEqual({ id: first, publicUrl: expect.any(String), altText: 'Concert artwork' });
  });

  it('expires pending uploads and retries deletion failures while still cleaning other objects', async () => {
    const first = await intent(); const second = await intent();
    const expired = new Date(now.getTime() + 15 * 60_000);
    await expect(completeCarouselUpload({ ...context(), imageId: first, now: expired, verifyUploadedObject: verified })).rejects.toThrow('expired');
    const firstImage = await database.carouselImage.findUniqueOrThrow({ where: { id: first } });
    await expect(cleanupCarouselImages({ database, now: expired, deleteObject: async (key) => { if (key === firstImage.objectKey) throw new Error('R2 unavailable'); } })).rejects.toThrow('cleanup failed');
    expect(await database.carouselImage.findUnique({ where: { id: second } })).toBeNull();
    expect((await database.carouselImage.findUniqueOrThrow({ where: { id: first } })).status).toBe('DELETING');
    await cleanupCarouselImages({ database, now: expired, deleteObject: async () => undefined });
    expect(await database.carouselImage.findUnique({ where: { id: first } })).toBeNull();
  });

  it('unpublishes before deleting, records removal once and prevents completion from resurrecting a deletion', async () => {
    const id = await intent();
    await completeCarouselUpload({ ...context(), imageId: id, now, verifyUploadedObject: verified });
    await expect(removeCarouselImage({ ...context(), imageId: id, deleteObject: async () => { expect((await listPublicCarouselImages(database)).some((image) => image.id === id)).toBe(false); throw new Error('R2 failed'); } })).rejects.toThrow('R2 failed');
    await expect(completeCarouselUpload({ ...context(), imageId: id, now, verifyUploadedObject: verified })).rejects.toThrow('unavailable');
    await removeCarouselImage({ ...context(), imageId: id, deleteObject: async () => undefined });
    expect(await database.auditLog.count({ where: { targetId: id, action: 'CAROUSEL_IMAGE_REMOVED' } })).toBe(1);
    await cleanupCarouselImages({ database, now: new Date(now.getTime() + 16 * 60_000), deleteObject: async () => undefined });
    expect(await database.carouselImage.findUnique({ where: { id } })).toBeNull();
  });

  it('cannot publish a removed image when verification races with removal', async () => {
    const id = await intent();
    await expect(completeCarouselUpload({ ...context(), imageId: id, now, verifyUploadedObject: async () => { await removeCarouselImage({ ...context(), imageId: id, deleteObject: async () => undefined }); return true; } })).rejects.toThrow('unavailable');
    expect((await database.carouselImage.findUniqueOrThrow({ where: { id } })).status).toBe('DELETING');
  });

  it('constrains carousel R2 uploads and keeps event-media operations isolated', async () => {
    const commands: Record<string, unknown>[] = [];
    const store = createR2ObjectStore({ config, client: { send: async (command) => { commands.push(command.input); return { ContentType: 'image/png', ContentLength: 1024 }; } }, signUrl: async (_client, command, options) => { expect(options.expiresIn).toBe(300); commands.push((command as { input: Record<string, unknown> }).input); return 'https://signed.example.test'; } });
    const upload = await store.createCarouselImageUploadUrl({ contentType: 'image/png', contentLength: 1024 });
    expect(upload.objectKey).toMatch(/^carousel\/[a-f0-9-]+\.png$/);
    expect(commands[0]).toMatchObject({ ContentType: 'image/png', ContentLength: 1024 });
    await expect(store.verifyCarouselImage({ ...upload, contentType: 'image/png', contentLength: 1024 })).resolves.toBe(true);
    await expect(store.verifyCarouselImage({ ...upload, contentType: 'image/png', contentLength: 9 })).resolves.toBe(false);
    await expect(store.verifyCarouselImage({ objectKey: 'events/event/media/image.png', contentType: 'image/png', contentLength: 1024 })).resolves.toBe(false);
    await expect(store.verifyPublicImage({ ...upload, contentType: 'image/png', contentLength: 1024 })).resolves.toBe(false);
    await expect(store.deletePublicObject({ objectKey: upload.objectKey })).rejects.toThrow('object key');
    await expect(store.deleteCarouselObject({ objectKey: 'events/event/media/image.png' })).rejects.toThrow('object key');
    const missing = createR2ObjectStore({ config, client: { send: async () => { throw new Error('not found'); } } });
    await expect(missing.verifyCarouselImage({ ...upload, contentType: 'image/png', contentLength: 1024 })).resolves.toBe(false);
    await expect(store.createCarouselImageUploadUrl({ contentType: 'image/svg+xml', contentLength: 1 })).rejects.toThrow('image type');
    await expect(store.createCarouselImageUploadUrl({ contentType: 'image/png', contentLength: 5242881 })).rejects.toThrow('image size');
  });
});
