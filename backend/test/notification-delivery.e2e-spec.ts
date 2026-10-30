import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type NotificationDelivery = {
  deliverPendingNotifications(input: {
    database: ReturnType<typeof createDatabaseClient>;
    sender: { send(input: { to: string; subject: string; text: string }): Promise<void> };
    now: Date;
    maxAttempts: number;
  }): Promise<{ sent: number; retried: number; failed: number }>;
};

async function loadNotificationDelivery(): Promise<NotificationDelivery | undefined> {
  try {
    return await import('../src/worker/notification-delivery.js') as NotificationDelivery;
  } catch {
    return undefined;
  }
}

describe('notification delivery outbox', () => {
  let client: ReturnType<typeof createDatabaseClient> | undefined;
  let jobIds: string[] = [];

  afterEach(async () => {
    if (client) {
      if (jobIds.length) await client.notificationJob.deleteMany({ where: { id: { in: jobIds } } });
      await client.$disconnect();
    }
    client = undefined;
    jobIds = [];
  });

  it('delivers a durable pending notification exactly once and marks it sent', async () => {
    const delivery = await loadNotificationDelivery();
    const databaseUrl = process.env.DATABASE_URL;
    expect(delivery).toBeDefined();
    if (!delivery || !databaseUrl) throw new Error('notification delivery is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    const job = await client.notificationJob.create({
      data: { type: 'ORDER_CONFIRMATION', recipientEmail: 'buyer@example.test', idempotencyKey: `delivery-success-${Date.now()}` },
      select: { id: true },
    });
    jobIds.push(job.id);
    const sent: Array<{ to: string; subject: string; text: string }> = [];

    await expect(delivery.deliverPendingNotifications({
      database: client,
      sender: { send: async (message) => { sent.push(message); } },
      now: new Date('2032-01-01T10:00:00.000Z'),
      maxAttempts: 3,
    })).resolves.toEqual({ sent: 1, retried: 0, failed: 0 });

    expect(sent).toEqual([{ to: 'buyer@example.test', subject: 'Your EverythingTicket order', text: 'Your ticket order is confirmed.' }]);
    await expect(client.notificationJob.findUnique({ where: { id: job.id }, select: { status: true, attempts: true, sentAt: true, failureDetail: true } })).resolves.toEqual({ status: 'SENT', attempts: 1, sentAt: new Date('2032-01-01T10:00:00.000Z'), failureDetail: null });
  });

  it('retains a failed attempt for retry and marks it failed only at the configured limit', async () => {
    const delivery = await loadNotificationDelivery();
    const databaseUrl = process.env.DATABASE_URL;
    expect(delivery).toBeDefined();
    if (!delivery || !databaseUrl) throw new Error('notification delivery is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    const job = await client.notificationJob.create({
      data: { type: 'RSVP_CONFIRMATION', recipientEmail: 'guest@example.test', idempotencyKey: `delivery-retry-${Date.now()}` },
      select: { id: true },
    });
    jobIds.push(job.id);
    const unavailable = { send: async (): Promise<void> => { throw new Error('SMTP unavailable'); } };

    await expect(delivery.deliverPendingNotifications({ database: client, sender: unavailable, now: new Date('2032-01-01T10:00:00.000Z'), maxAttempts: 2 })).resolves.toEqual({ sent: 0, retried: 1, failed: 0 });
    await expect(client.notificationJob.findUnique({ where: { id: job.id }, select: { status: true, attempts: true, failureDetail: true } })).resolves.toEqual({ status: 'PENDING', attempts: 1, failureDetail: 'SMTP unavailable' });

    await expect(delivery.deliverPendingNotifications({ database: client, sender: unavailable, now: new Date('2032-01-01T10:01:00.000Z'), maxAttempts: 2 })).resolves.toEqual({ sent: 0, retried: 0, failed: 1 });
    await expect(client.notificationJob.findUnique({ where: { id: job.id }, select: { status: true, attempts: true, failureDetail: true } })).resolves.toEqual({ status: 'FAILED', attempts: 2, failureDetail: 'SMTP unavailable' });
  });

  it('delivers a generic organizer decision notification without exposing financial internals', async () => {
    const delivery = await loadNotificationDelivery();
    const databaseUrl = process.env.DATABASE_URL;
    expect(delivery).toBeDefined();
    if (!delivery || !databaseUrl) throw new Error('notification delivery is unavailable');
    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    const job = await client.notificationJob.create({
      data: { type: 'REFUND_DECISION', recipientEmail: 'organizer@example.test', idempotencyKey: `refund-decision-${Date.now()}` },
      select: { id: true },
    });
    jobIds.push(job.id);
    const messages: Array<{ subject: string; text: string }> = [];

    await delivery.deliverPendingNotifications({ database: client, sender: { send: async (message) => { messages.push({ subject: message.subject, text: message.text }); } }, now: new Date('2032-01-01T10:00:00.000Z'), maxAttempts: 3 });

    expect(messages).toEqual([{ subject: 'Your EverythingTicket update', text: 'There is an update to your organizer request.' }]);
  });
});
