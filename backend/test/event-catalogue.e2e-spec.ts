import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type EventCatalogue = {
  createOwnedEvent(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; categoryId: string; title: string; slug: string; description: string; city: string; state: string; venue: string; address: string; timeZone: string; startAt: Date; endAt: Date }): Promise<{ id: string }>;
  listPublicEvents(input: { database: ReturnType<typeof createDatabaseClient>; query?: string; city?: string; state?: string; category?: string; sort?: 'upcoming' | 'featured' | 'popular'; page?: number }): Promise<{ items: Array<{ id: string; slug: string; title: string; description: string; city: string; state: string; venue: string; startAt: Date; endAt: Date; category: { name: string; slug: string }; organizer: { name: string }; media: Array<{ id: string; publicUrl: string }>; availableTickets: number }>; page: number; total: number }>;
  getPublicEvent(input: { database: ReturnType<typeof createDatabaseClient>; slug: string }): Promise<{ id: string; slug: string; title: string; description: string; city: string; state: string; venue: string; address: string; timeZone: string; startAt: Date; endAt: Date; category: { name: string; slug: string }; organizer: { name: string }; media: Array<{ id: string; publicUrl: string }>; ticketTypes: Array<{ id: string; name: string; description: string | null; priceKobo: number; salesStartAt: Date | null; salesEndAt: Date | null; maxPerOrder: number | null; availableTickets: number }> } | null>;
  publishOwnedEvent(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; now: Date }): Promise<void>;
  updateOwnedEvent(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; title?: string; description?: string; city?: string; state?: string; venue?: string; address?: string; timeZone?: string; startAt?: Date; endAt?: Date }): Promise<void>;
  unpublishOwnedEvent(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string }): Promise<void>;
  createOwnedTicketType(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; name: string; description?: string; priceKobo: number; capacity: number; salesStartAt?: Date; salesEndAt?: Date; maxPerOrder?: number }): Promise<{ id: string }>;
  updateOwnedTicketType(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; ticketTypeId: string; name?: string; description?: string | null; priceKobo?: number; capacity?: number; salesStartAt?: Date | null; salesEndAt?: Date | null; maxPerOrder?: number | null; isActive?: boolean }): Promise<void>;
  removeOwnedTicketType(input: { database: ReturnType<typeof createDatabaseClient>; organizerProfileId: string; eventId: string; ticketTypeId: string }): Promise<void>;
};

async function loadEventCatalogue(): Promise<EventCatalogue | undefined> {
  try {
    return await import('../src/events/event-catalogue.js') as EventCatalogue;
  } catch {
    return undefined;
  }
}

describe('event catalogue', () => {
  const ids: Record<string, string> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      await client.eventMedia.deleteMany({ where: { eventId: { in: [ids.eventId ?? '', ids.createdEventId ?? ''] } } });
      await client.ticketType.deleteMany({ where: { eventId: { in: [ids.eventId ?? '', ids.createdEventId ?? ''] } } });
      await client.event.deleteMany({ where: { id: { in: [ids.eventId ?? '', ids.createdEventId ?? ''] } } });
      if (ids.categoryId) await client.eventCategory.deleteMany({ where: { id: ids.categoryId } });
      if (ids.userId) await client.auth_user.deleteMany({ where: { id: ids.userId } });
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('publishes a valid organizer-owned event and returns it through public discovery', async () => {
    const catalogue = await loadEventCatalogue();
    const databaseUrl = process.env.DATABASE_URL;
    expect(catalogue).toBeDefined();
    if (!catalogue || !databaseUrl) throw new Error('event catalogue is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await catalogue.publishOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, now: new Date('2032-01-01T10:00:00.000Z') });
    await expect(catalogue.listPublicEvents({ database: client, query: 'design', city: 'Lagos', category: 'design' })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ slug: 'design-summit', title: 'Design Summit', availableTickets: 0 })], page: 1, total: 1,
    }));
    await expect(catalogue.getPublicEvent({ database: client, slug: 'design-summit' })).resolves.toEqual(expect.objectContaining({ slug: 'design-summit', title: 'Design Summit', ticketTypes: [] }));
  });

  it('returns the identifiers required to quote and create an order from public event detail', async () => {
    const catalogue = await loadEventCatalogue();
    const databaseUrl = process.env.DATABASE_URL;
    expect(catalogue).toBeDefined();
    if (!catalogue || !databaseUrl) throw new Error('event catalogue is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const ticketTypeId = (await catalogue.createOwnedTicketType({
      database: client,
      organizerProfileId: ids.profileId,
      eventId: ids.eventId,
      name: 'Checkout General',
      priceKobo: 750000,
      capacity: 25,
      maxPerOrder: 5,
    })).id;
    await catalogue.publishOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, now: new Date('2032-01-01T10:00:00.000Z') });

    await expect(catalogue.getPublicEvent({ database: client, slug: 'design-summit' })).resolves.toEqual(expect.objectContaining({
      id: ids.eventId,
      ticketTypes: [expect.objectContaining({ id: ticketTypeId, name: 'Checkout General' })],
    }));
  });

  it('finds a public event by its identifier as well as its slug', async () => {
    const catalogue = await loadEventCatalogue();
    const databaseUrl = process.env.DATABASE_URL;
    expect(catalogue).toBeDefined();
    if (!catalogue || !databaseUrl) throw new Error('event catalogue is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    await catalogue.publishOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, now: new Date('2032-01-01T10:00:00.000Z') });

    await expect(catalogue.getPublicEvent({ database: client, slug: ids.eventId })).resolves.toEqual(expect.objectContaining({ id: ids.eventId, slug: 'design-summit' }));
  });

  it('returns complete public presentation fields and only ready media', async () => {
    const catalogue = await loadEventCatalogue();
    const databaseUrl = process.env.DATABASE_URL;
    expect(catalogue).toBeDefined();
    if (!catalogue || !databaseUrl) throw new Error('event catalogue is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);
    const readyMediaId = randomUUID();
    const coverMediaId = randomUUID();
    const lastMediaId = randomUUID();
    await client.eventMedia.createMany({ data: [
      { id: readyMediaId, eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/ready.png`, publicUrl: 'https://media.example.test/ready.png', contentType: 'image/png', contentLength: 1024, status: 'READY', position: 0, expiresAt: new Date('2032-01-01T10:15:00.000Z'), completedAt: new Date('2032-01-01T10:01:00.000Z') },
      { id: coverMediaId, eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/cover.png`, publicUrl: 'https://media.example.test/cover.png', contentType: 'image/png', contentLength: 1024, status: 'READY', position: 1, isCover: true, expiresAt: new Date('2032-01-01T10:15:00.000Z'), completedAt: new Date('2032-01-01T10:01:00.000Z') },
      { id: lastMediaId, eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/last.png`, publicUrl: 'https://media.example.test/last.png', contentType: 'image/png', contentLength: 1024, status: 'READY', position: 2, expiresAt: new Date('2032-01-01T10:15:00.000Z'), completedAt: new Date('2032-01-01T10:01:00.000Z') },
      { id: randomUUID(), eventId: ids.eventId, objectKey: `events/${ids.eventId}/media/pending.png`, publicUrl: 'https://media.example.test/pending.png', contentType: 'image/png', contentLength: 1024, status: 'PENDING', expiresAt: new Date('2032-01-01T10:15:00.000Z') },
    ] });
    await catalogue.publishOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, now: new Date('2032-01-01T10:00:00.000Z') });

    const publicFields = {
      id: ids.eventId,
      description: 'A design event',
      city: 'Lagos',
      state: 'Lagos',
      venue: 'Venue',
      startAt: new Date('2032-02-01T10:00:00.000Z'),
      endAt: new Date('2032-02-01T12:00:00.000Z'),
      category: { name: 'Design', slug: 'design' },
      organizer: { name: 'Organizer' },
      media: [
        { id: coverMediaId, publicUrl: 'https://media.example.test/cover.png', isCover: true },
        { id: readyMediaId, publicUrl: 'https://media.example.test/ready.png', isCover: false },
        { id: lastMediaId, publicUrl: 'https://media.example.test/last.png', isCover: false },
      ],
    };
    await expect(catalogue.listPublicEvents({ database: client, query: 'A design event' })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining(publicFields)],
    }));
    await expect(catalogue.getPublicEvent({ database: client, slug: 'design-summit' })).resolves.toEqual(expect.objectContaining({
      ...publicFields,
      address: 'Address',
      timeZone: 'Africa/Lagos',
    }));
  });

  it('creates a valid draft only for an active organizer', async () => {
    const catalogue = await loadEventCatalogue();
    const databaseUrl = process.env.DATABASE_URL;
    expect(catalogue).toBeDefined();
    if (!catalogue || !databaseUrl) throw new Error('event catalogue is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    ids.createdEventId = (await catalogue.createOwnedEvent({
      database: client, organizerProfileId: ids.profileId, categoryId: ids.categoryId, title: 'Second Event', slug: 'second-event', description: 'Description', city: 'Lagos', state: 'Lagos', venue: 'Venue', address: 'Address', timeZone: 'Africa/Lagos', startAt: new Date('2032-03-01T10:00:00.000Z'), endAt: new Date('2032-03-01T12:00:00.000Z'),
    })).id;
    expect(ids.createdEventId).toEqual(expect.any(String));
  });

  it('lets an owner manage ticket types only while its event is a draft', async () => {
    const catalogue = await loadEventCatalogue();
    const databaseUrl = process.env.DATABASE_URL;
    expect(catalogue).toBeDefined();
    if (!catalogue || !databaseUrl) throw new Error('event catalogue is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createFixture(client, ids);

    await catalogue.updateOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, title: 'Updated Design Summit' });
    const ticketTypeId = (await catalogue.createOwnedTicketType({
      database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, name: 'General', description: 'Entry', priceKobo: 500000, capacity: 20, maxPerOrder: 4,
    })).id;
    await catalogue.updateOwnedTicketType({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, ticketTypeId, priceKobo: 600000, capacity: 25, isActive: false });
    await expect(client.ticketType.findUnique({ where: { id: ticketTypeId }, select: { priceKobo: true, capacity: true, isActive: true } })).resolves.toEqual({ priceKobo: 600000, capacity: 25, isActive: false });

    await catalogue.removeOwnedTicketType({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, ticketTypeId });
    await expect(client.ticketType.findUnique({ where: { id: ticketTypeId } })).resolves.toBeNull();
    await catalogue.publishOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, now: new Date('2032-01-01T10:00:00.000Z') });
    await expect(catalogue.createOwnedTicketType({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId, name: 'Late', priceKobo: 1, capacity: 1 })).rejects.toThrow('event is unavailable to this organizer');
    await catalogue.unpublishOwnedEvent({ database: client, organizerProfileId: ids.profileId, eventId: ids.eventId });
    await expect(client.event.findUnique({ where: { id: ids.eventId }, select: { status: true, publishedAt: true } })).resolves.toEqual({ status: 'DRAFT', publishedAt: null });
  });
});

async function createFixture(client: ReturnType<typeof createDatabaseClient>, ids: Record<string, string>): Promise<void> {
  Object.assign(ids, { userId: randomUUID(), profileId: randomUUID(), categoryId: randomUUID(), eventId: randomUUID() });
  await client.$executeRaw`INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${ids.userId}, 'Organizer', ${`${ids.userId}@example.test`}, true, NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt") VALUES (${ids.profileId}, ${ids.userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt") VALUES (${ids.categoryId}, 'Design', 'design', NOW(), NOW())`;
  await client.$executeRaw`INSERT INTO event (id, "organizerProfileId", "categoryId", title, slug, description, city, state, venue, address, "timeZone", "startAt", "endAt", status, "createdAt", "updatedAt") VALUES (${ids.eventId}, ${ids.profileId}, ${ids.categoryId}, 'Design Summit', 'design-summit', 'A design event', 'Lagos', 'Lagos', 'Venue', 'Address', 'Africa/Lagos', '2032-02-01T10:00:00.000Z', '2032-02-01T12:00:00.000Z', 'DRAFT', NOW(), NOW())`;
}
