import type { PrismaClient } from '../generated/prisma/client.js';
import { encodeEmailPayload, renderNotificationEmail } from './email-templates.js';

export type EmailAttachment = { filename: string; content: Uint8Array; contentType: 'application/pdf' };
export type EmailMessage = { to: string; subject: string; text: string; html?: string; attachments?: EmailAttachment[] };
export type EmailSender = { send(message: EmailMessage): Promise<void> };
export type PrivateTicketStore = { getPrivatePdf(input: { objectKey: string }): Promise<Uint8Array> };

export async function deliverPendingNotifications({
  database, sender, now, maxAttempts, publicAppUrl = process.env.PUBLIC_APP_URL ?? 'https://everyticket.vercel.app', ticketStore,
}: {
  database: PrismaClient; sender: EmailSender; now: Date; maxAttempts: number; publicAppUrl?: string; ticketStore?: PrivateTicketStore;
}): Promise<{ sent: number; retried: number; failed: number; deferred: number }> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');
  await database.notificationJob.updateMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, data: { status: 'PENDING' } });
  const jobs = await database.notificationJob.findMany({
    where: { status: 'PENDING', attempts: { lt: maxAttempts } }, orderBy: { createdAt: 'asc' },
    select: { id: true, orderId: true, type: true, recipientEmail: true, content: true, attempts: true },
  });
  let sent = 0; let retried = 0; let failed = 0; let deferred = 0;
  for (const job of jobs) {
    const claimed = await database.notificationJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'SENDING' } });
    if (claimed.count !== 1) continue;
    try {
      const content = await hydrateOrderContent({ database, orderId: job.orderId, content: job.content });
      const attachments = ticketStore && job.type === 'ORDER_CONFIRMATION' && job.orderId
        ? await ticketAttachments({ database, ticketStore, orderId: job.orderId }) : undefined;
      if (attachments === 'PENDING') {
        await database.notificationJob.update({ where: { id: job.id }, data: { status: 'PENDING' } });
        deferred += 1;
        continue;
      }
      const message = notificationMessage({ type: job.type, to: job.recipientEmail, content, publicAppUrl });
      await sender.send({ ...message, ...(attachments?.length ? { attachments } : {}) });
      await database.notificationJob.update({ where: { id: job.id }, data: { status: 'SENT', attempts: job.attempts + 1, sentAt: now, failureDetail: null } });
      sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1; const terminal = attempts >= maxAttempts;
      await database.notificationJob.update({ where: { id: job.id }, data: { status: terminal ? 'FAILED' : 'PENDING', attempts, failureDetail: errorMessage(error) } });
      if (terminal) failed += 1; else retried += 1;
    }
  }
  return { sent, retried, failed, deferred };
}

export function notificationMessage({ type, to, content, publicAppUrl = 'https://everyticket.vercel.app' }: { type: string; to: string; content?: string | null; publicAppUrl?: string }): EmailMessage {
  return { to, ...renderNotificationEmail({ type, content, publicAppUrl }) };
}

async function hydrateOrderContent({ database, orderId, content }: { database: PrismaClient; orderId: string | null; content: string | null }): Promise<string | null> {
  if (!orderId) return content;
  const order = await database.order.findUnique({
    where: { id: orderId },
    select: { buyerName: true, reference: true, totalKobo: true, event: { select: { title: true } }, lines: { orderBy: { createdAt: 'asc' }, select: { ticketTypeName: true, quantity: true } } },
  });
  if (!order) return content;
  const parsed = parseContent(content);
  return encodeEmailPayload({
    buyerName: order.buyerName, eventTitle: order.event.title, orderReference: order.reference, totalKobo: order.totalKobo,
    ticketLines: order.lines.map((line) => ({ name: line.ticketTypeName, quantity: line.quantity })), ...parsed,
  });
}

async function ticketAttachments({ database, ticketStore, orderId }: { database: PrismaClient; ticketStore: PrivateTicketStore; orderId: string }): Promise<EmailAttachment[] | 'PENDING'> {
  const tickets = await database.ticket.findMany({
    where: { orderId }, orderBy: { issuedAt: 'asc' },
    select: { ticketTypeName: true, documentJob: { select: { status: true, objectKey: true } } },
  });
  if (!tickets.length || tickets.some((ticket) => ticket.documentJob?.status !== 'READY')) return 'PENDING';
  return Promise.all(tickets.map(async (ticket, index) => ({
    filename: `${safeFilename(ticket.ticketTypeName)}-ticket-${index + 1}.pdf`, content: await ticketStore.getPrivatePdf({ objectKey: ticket.documentJob!.objectKey }), contentType: 'application/pdf' as const,
  })));
}

function parseContent(content: string | null): Record<string, unknown> { try { const value: unknown = content ? JSON.parse(content) : {}; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; } }
function safeFilename(value: string): string { return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'everyticket'; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'notification delivery failed'; }
