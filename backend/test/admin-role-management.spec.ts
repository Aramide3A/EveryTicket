import { BadRequestException, ConflictException } from '@nestjs/common';

describe('administrator role management', () => {
  it('promotes another active profile while preserving its roles and auditing the change', async () => {
    const module = await import('../src/admin/admin-role-management.js');
    const auditEntries: unknown[] = [];
    const updates: unknown[] = [];
    const database = {
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(database),
      applicationProfile: {
        findFirst: async ({ where }: { where: { id: string } }) => where.id === 'admin-1'
          ? { id: 'admin-1', role: 'ADMIN', roles: ['CUSTOMER', 'ADMIN'], status: 'ACTIVE' }
          : { id: 'target-1', role: 'ORGANIZER', roles: ['CUSTOMER', 'ORGANIZER'], status: 'ACTIVE' },
        update: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { id: 'target-1', ...(data as object) };
        },
      },
      auditLog: { create: async ({ data }: { data: unknown }) => { auditEntries.push(data); } },
    };

    await expect(module.setProfileAdministrator({ database: database as never, adminProfileId: 'admin-1', profileId: 'target-1', enabled: true }))
      .resolves.toEqual({ id: 'target-1', role: 'ADMIN', roles: ['CUSTOMER', 'ORGANIZER', 'ADMIN'] });
    expect(updates).toEqual([{ role: 'ADMIN', roles: { set: ['CUSTOMER', 'ORGANIZER', 'ADMIN'] } }]);
    expect(auditEntries).toEqual([expect.objectContaining({
      actorProfileId: 'admin-1',
      action: 'ACCOUNT_ADMIN_GRANTED',
      targetType: 'APPLICATION_PROFILE',
      targetId: 'target-1',
    })]);
  });

  it('rejects a self-promotion or self-demotion', async () => {
    const module = await import('../src/admin/admin-role-management.js');
    const database = { $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(database) };

    await expect(module.setProfileAdministrator({ database: database as never, adminProfileId: 'admin-1', profileId: 'admin-1', enabled: false }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects promotion when the target already has administrator access', async () => {
    const module = await import('../src/admin/admin-role-management.js');
    const database = {
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(database),
      applicationProfile: {
        findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id, role: 'ADMIN', roles: ['CUSTOMER', 'ADMIN'], status: 'ACTIVE' }),
      },
    };

    await expect(module.setProfileAdministrator({ database: database as never, adminProfileId: 'admin-1', profileId: 'target-1', enabled: true }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not allow an admin to remove the final active administrator', async () => {
    const module = await import('../src/admin/admin-role-management.js');
    const database = {
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(database),
      applicationProfile: {
        findFirst: async ({ where }: { where: { id: string } }) => where.id === 'admin-1'
          ? { id: 'admin-1', role: 'ADMIN', roles: ['CUSTOMER', 'ADMIN'], status: 'ACTIVE' }
          : { id: 'target-1', role: 'ADMIN', roles: ['CUSTOMER', 'ADMIN'], status: 'ACTIVE' },
        count: async () => 1,
      },
    };

    await expect(module.setProfileAdministrator({ database: database as never, adminProfileId: 'admin-1', profileId: 'target-1', enabled: false }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
