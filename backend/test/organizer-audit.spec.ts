import { createOwnedEvent } from '../src/events/event-catalogue.js';

describe('organizer audit records', () => {
  it('records the organizer when an event is created', async () => {
    const auditRecords: unknown[] = [];
    const database = {
      applicationProfile: { findFirst: async () => ({ id: 'organizer-1' }) },
      event: { create: async () => ({ id: 'event-1' }) },
      auditLog: { create: async ({ data }: { data: unknown }) => { auditRecords.push(data); } },
    };

    await expect(createOwnedEvent({
      database: database as never,
      organizerProfileId: 'organizer-1',
      categoryId: 'category-1',
      title: 'Town Hall',
      slug: 'town-hall',
      description: 'Community event',
      city: 'Lagos',
      state: 'Lagos',
      venue: 'Hall',
      address: '1 Main Street',
      timeZone: 'Africa/Lagos',
      startAt: new Date('2031-01-02T10:00:00.000Z'),
      endAt: new Date('2031-01-02T12:00:00.000Z'),
    })).resolves.toEqual({ id: 'event-1' });
    expect(auditRecords).toEqual([expect.objectContaining({ actorProfileId: 'organizer-1', action: 'EVENT_CREATED', targetType: 'EVENT', targetId: 'event-1' })]);
  });
});
