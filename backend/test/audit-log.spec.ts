import { pageAuditLogs } from '../src/audit/audit-log.js';

describe('audit log history', () => {
  it('limits an organizer to their own audit records', async () => {
    const requested: unknown[] = [];
    const database = {
      applicationProfile: { findFirst: async () => ({ id: 'organizer-1' }) },
      auditLog: {
        findMany: async (input: unknown) => { requested.push(input); return [{ id: 'log-1', action: 'EVENT_CREATED', targetType: 'EVENT', targetId: 'event-1', details: null, createdAt: new Date('2031-01-01T00:00:00.000Z') }]; },
        count: async () => 1,
      },
    };

    await expect(pageAuditLogs({ database: database as never, profileId: 'organizer-1', role: 'ORGANIZER', page: 1, pageSize: 20 })).resolves.toEqual({ items: [{ id: 'log-1', action: 'EVENT_CREATED', targetType: 'EVENT', targetId: 'event-1', details: null, createdAt: new Date('2031-01-01T00:00:00.000Z') }], page: 1, pageSize: 20, total: 1 });
    expect(requested[0]).toEqual(expect.objectContaining({ where: { actorProfileId: 'organizer-1' } }));
  });

  it('allows an administrator to review the complete audit trail', async () => {
    const requested: unknown[] = [];
    const database = {
      applicationProfile: { findFirst: async () => ({ id: 'admin-1' }) },
      auditLog: {
        findMany: async (input: unknown) => { requested.push(input); return []; },
        count: async () => 0,
      },
    };

    await expect(pageAuditLogs({ database: database as never, profileId: 'admin-1', role: 'ADMIN', page: 2, pageSize: 10 })).resolves.toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
    expect(requested[0]).toEqual(expect.objectContaining({ where: {} }));
  });
});
