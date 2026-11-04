import type { PrismaClient } from '../generated/prisma/client.js';

export type EmailSender = {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
};

export async function deliverPendingNotifications({
  database,
  sender,
  now,
  maxAttempts,
}: {
  database: PrismaClient;
  sender: EmailSender;
  now: Date;
  maxAttempts: number;
}): Promise<{ sent: number; retried: number; failed: number }> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');
  await database.notificationJob.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    data: { status: 'PENDING' },
  });
  const jobs = await database.notificationJob.findMany({
    where: { status: 'PENDING', attempts: { lt: maxAttempts } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, recipientEmail: true, content: true, attempts: true },
  });
  let sent = 0;
  let retried = 0;
  let failed = 0;
  for (const job of jobs) {
    const claimed = await database.notificationJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'SENDING' } });
    if (claimed.count !== 1) continue;
    try {
      await sender.send(notificationMessage({ type: job.type, to: job.recipientEmail, content: job.content }));
      await database.notificationJob.update({ where: { id: job.id }, data: { status: 'SENT', attempts: job.attempts + 1, sentAt: now, failureDetail: null } });
      sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const terminal = attempts >= maxAttempts;
      await database.notificationJob.update({
        where: { id: job.id },
        data: { status: terminal ? 'FAILED' : 'PENDING', attempts, failureDetail: errorMessage(error) },
      });
      if (terminal) failed += 1;
      else retried += 1;
    }
  }
  return { sent, retried, failed };
}

export function notificationMessage({ type, to, content }: { type: 'ORDER_CONFIRMATION' | 'RSVP_CONFIRMATION' | 'REFUND_DECISION' | 'PAYOUT_DECISION'; to: string; content?: string | null }): { to: string; subject: string; text: string } {
  if (type === 'ORDER_CONFIRMATION') return { to, subject: 'Your EverythingTicket order', text: 'Your ticket order is confirmed.' };
  if (type === 'RSVP_CONFIRMATION') return { to, subject: 'Your EverythingTicket RSVP', text: content ?? 'Your RSVP is confirmed.' };
  return { to, subject: 'Your EverythingTicket update', text: 'There is an update to your organizer request.' };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'notification delivery failed';
}
