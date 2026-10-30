import { randomUUID } from 'node:crypto';

type R2ObjectStoreModule = {
  createR2ObjectStore(input: {
    config: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicMediaUrl: string };
    client?: { send(command: { input: Record<string, unknown> }): Promise<unknown> };
    signUrl?: (client: unknown, command: unknown, options: { expiresIn: number }) => Promise<string>;
  }): {
    createPublicImageUploadUrl(input: { eventId: string; contentType: string; contentLength: number }): Promise<{ objectKey: string; uploadUrl: string; publicUrl: string }>;
    putPrivatePdf(input: { objectKey: string; pdf: Uint8Array }): Promise<void>;
    createPrivateDownloadUrl(input: { objectKey: string }): Promise<string>;
    verifyPublicImage(input: { objectKey: string; contentType: string; contentLength: number }): Promise<boolean>;
    deletePublicObject(input: { objectKey: string }): Promise<void>;
  };
};

async function loadR2ObjectStore(): Promise<R2ObjectStoreModule | undefined> {
  try {
    return await import('../src/worker/r2-object-store.js') as R2ObjectStoreModule;
  } catch {
    return undefined;
  }
}

describe('R2 object storage boundary', () => {
  const config = {
    endpoint: 'https://account.r2.cloudflarestorage.com',
    bucket: 'everythingticket-private',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    publicMediaUrl: 'https://media.example.test',
  };

  it('creates a constrained public image upload intent and a cacheable public path', async () => {
    const r2 = await loadR2ObjectStore();
    expect(r2).toBeDefined();
    if (!r2) throw new Error('R2 object store is unavailable');
    const eventId = randomUUID();
    const store = r2.createR2ObjectStore({ config, signUrl: async (_client, command) => `https://signed.example.test/${(command as { input: { Key: string } }).input.Key}` });

    await expect(store.createPublicImageUploadUrl({ eventId, contentType: 'image/png', contentLength: 1_024 })).resolves.toEqual({
      objectKey: expect.stringMatching(new RegExp(`^events/${eventId}/media/[a-f0-9-]+\\.png$`)),
      uploadUrl: expect.stringMatching(/^https:\/\/signed\.example\.test\/events\//),
      publicUrl: expect.stringMatching(new RegExp(`^https://media\\.example\\.test/events/${eventId}/media/`)),
    });
  });

  it('writes ticket PDFs with private content metadata and signs short-lived downloads', async () => {
    const r2 = await loadR2ObjectStore();
    expect(r2).toBeDefined();
    if (!r2) throw new Error('R2 object store is unavailable');
    const commands: Array<Record<string, unknown>> = [];
    const store = r2.createR2ObjectStore({
      config,
      client: { send: async (command) => { commands.push(command.input); } },
      signUrl: async (_client, command, options) => `https://private.example.test/${(command as { input: { Key: string } }).input.Key}?expires=${options.expiresIn}`,
    });

    await store.putPrivatePdf({ objectKey: 'tickets/ticket-1.pdf', pdf: new Uint8Array([1, 2, 3]) });
    await expect(store.createPrivateDownloadUrl({ objectKey: 'tickets/ticket-1.pdf' })).resolves.toBe('https://private.example.test/tickets/ticket-1.pdf?expires=300');
    expect(commands).toEqual([{ Bucket: 'everythingticket-private', Key: 'tickets/ticket-1.pdf', Body: new Uint8Array([1, 2, 3]), ContentType: 'application/pdf', CacheControl: 'private, no-store' }]);
  });

  it('rejects non-images and oversized uploads before creating a signed URL', async () => {
    const r2 = await loadR2ObjectStore();
    expect(r2).toBeDefined();
    if (!r2) throw new Error('R2 object store is unavailable');
    const store = r2.createR2ObjectStore({ config });

    await expect(store.createPublicImageUploadUrl({ eventId: randomUUID(), contentType: 'application/pdf', contentLength: 1 })).rejects.toThrow('image type');
    await expect(store.createPublicImageUploadUrl({ eventId: randomUUID(), contentType: 'image/jpeg', contentLength: 5 * 1024 * 1024 + 1 })).rejects.toThrow('image size');
  });

  it('checks and removes only event-media objects when cleaning expired intents', async () => {
    const r2 = await loadR2ObjectStore();
    expect(r2).toBeDefined();
    if (!r2) throw new Error('R2 object store is unavailable');
    const commands: Array<Record<string, unknown>> = [];
    const store = r2.createR2ObjectStore({ config, client: { send: async (command) => { commands.push(command.input); return { ContentType: 'image/png', ContentLength: 1_024 }; } } });
    const objectKey = `events/${randomUUID()}/media/stale.png`;

    await expect(store.verifyPublicImage({ objectKey, contentType: 'image/png', contentLength: 1_024 })).resolves.toBe(true);
    await store.deletePublicObject({ objectKey });
    await expect(store.verifyPublicImage({ objectKey: 'tickets/private.pdf', contentType: 'image/png', contentLength: 1_024 })).resolves.toBe(false);
    expect(commands).toEqual([
      { Bucket: 'everythingticket-private', Key: objectKey },
      { Bucket: 'everythingticket-private', Key: objectKey },
    ]);
  });

  it('rejects an uploaded object whose actual metadata differs from the signed image intent', async () => {
    const r2 = await loadR2ObjectStore();
    expect(r2).toBeDefined();
    if (!r2) throw new Error('R2 object store is unavailable');
    const store = r2.createR2ObjectStore({
      config,
      client: { send: async () => ({ ContentType: 'image/jpeg', ContentLength: 1_024 }) },
    });

    await expect(store.verifyPublicImage({
      objectKey: `events/${randomUUID()}/media/upload.png`,
      contentType: 'image/png',
      contentLength: 1_024,
    })).resolves.toBe(false);
  });
});
