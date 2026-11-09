import { createEventCategory, listEventCategoriesForAdmin, updateEventCategory } from '../src/admin/category-administration.js';

describe('administrator event categories', () => {
  it('creates a normalized category and records the administrator who made it', async () => {
    const created: unknown[] = [];
    const database = {
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(database),
      applicationProfile: { findFirst: async () => ({ id: 'admin-profile' }) },
      eventCategory: {
        findFirst: async () => null,
        create: async ({ data }: { data: unknown }) => ({ id: 'category-1', ...(data as object) }),
      },
      auditLog: { create: async ({ data }: { data: unknown }) => { created.push(data); } },
    };

    await expect(createEventCategory({ database: database as never, adminProfileId: 'admin-profile', name: '  Live Music  ', slug: ' Live Music ' })).resolves.toEqual({ id: 'category-1', name: 'Live Music', slug: 'live-music' });
    expect(created).toEqual([expect.objectContaining({ actorProfileId: 'admin-profile', action: 'EVENT_CATEGORY_CREATED', targetType: 'EVENT_CATEGORY', targetId: 'category-1' })]);
  });

  it('updates a category without changing its identifier and records the edit', async () => {
    const created: unknown[] = [];
    let categoryLookupCount = 0;
    const database = {
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(database),
      applicationProfile: { findFirst: async () => ({ id: 'admin-profile' }) },
      eventCategory: {
        findFirst: async () => {
          categoryLookupCount += 1;
          return categoryLookupCount === 1 ? { id: 'category-1', name: 'Music', slug: 'music' } : null;
        },
        update: async ({ data }: { data: unknown }) => ({ id: 'category-1', ...(data as object) }),
      },
      auditLog: { create: async ({ data }: { data: unknown }) => { created.push(data); } },
    };

    await expect(updateEventCategory({ database: database as never, adminProfileId: 'admin-profile', categoryId: 'category-1', name: 'Music events' })).resolves.toEqual({ id: 'category-1', name: 'Music events', slug: 'music' });
    expect(created).toEqual([expect.objectContaining({ actorProfileId: 'admin-profile', action: 'EVENT_CATEGORY_UPDATED', targetType: 'EVENT_CATEGORY', targetId: 'category-1' })]);
  });

  it('lists categories for an administrator in name order', async () => {
    const database = {
      applicationProfile: { findFirst: async () => ({ id: 'admin-profile' }) },
      eventCategory: { findMany: async () => [{ id: 'arts', name: 'Arts', slug: 'arts' }, { id: 'music', name: 'Music', slug: 'music' }] },
    };

    await expect(listEventCategoriesForAdmin({ database: database as never, adminProfileId: 'admin-profile' })).resolves.toEqual([{ id: 'arts', name: 'Arts', slug: 'arts' }, { id: 'music', name: 'Music', slug: 'music' }]);
  });
});
