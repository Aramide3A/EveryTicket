import type { PrismaClient } from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';

export async function listCustomerOrders({
  database,
  customerProfileId,
}: {
  database: PrismaClient;
  customerProfileId: string;
}): Promise<Array<{ reference: string; status: string; tickets: Array<{ id: string; ticketTypeName: string }> }>> {
  return database.order.findMany({
    where: { customerProfileId, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    select: {
      reference: true,
      status: true,
      tickets: { select: { id: true, ticketTypeName: true }, orderBy: { issuedAt: 'asc' } },
    },
  });
}

export async function getCustomerOrder({
  database,
  customerProfileId,
  orderReference,
}: {
  database: PrismaClient;
  customerProfileId: string;
  orderReference: string;
}): Promise<{ reference: string; status: string; ticketSubtotalKobo: number; platformFeeKobo: number; totalKobo: number; tickets: Array<{ id: string; ticketTypeName: string }> } | null> {
  return database.order.findFirst({
    where: { reference: orderReference, customerProfileId },
    select: {
      reference: true,
      status: true,
      ticketSubtotalKobo: true,
      platformFeeKobo: true,
      totalKobo: true,
      tickets: { select: { id: true, ticketTypeName: true }, orderBy: { issuedAt: 'asc' } },
    },
  });
}

export async function listCustomerTickets({
  database,
  customerProfileId,
}: {
  database: PrismaClient;
  customerProfileId: string;
}): Promise<Array<{ id: string; ticketTypeName: string; orderReference: string }>> {
  const tickets = await database.ticket.findMany({
    where: { order: { customerProfileId, status: 'PAID' } },
    orderBy: { issuedAt: 'desc' },
    select: { id: true, ticketTypeName: true, order: { select: { reference: true } } },
  });
  return tickets.map((ticket) => ({ id: ticket.id, ticketTypeName: ticket.ticketTypeName, orderReference: ticket.order.reference }));
}

export async function getCustomerTicket({
  database,
  customerProfileId,
  ticketId,
}: {
  database: PrismaClient;
  customerProfileId: string;
  ticketId: string;
}): Promise<{ id: string; ticketTypeName: string; orderReference: string } | null> {
  const ticket = await database.ticket.findFirst({
    where: { id: ticketId, order: { customerProfileId, status: 'PAID' } },
    select: { id: true, ticketTypeName: true, order: { select: { reference: true } } },
  });
  return ticket
    ? { id: ticket.id, ticketTypeName: ticket.ticketTypeName, orderReference: ticket.order.reference }
    : null;
}

export async function getCustomerTicketDocument({
  database,
  customerProfileId,
  ticketId,
}: {
  database: PrismaClient;
  customerProfileId: string;
  ticketId: string;
}): Promise<{ status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' } | null> {
  const documentJob = await database.ticketDocumentJob.findFirst({
    where: { ticketId, ticket: { order: { customerProfileId, status: 'PAID' } } },
    select: { status: true },
  });
  return documentJob ? { status: documentJob.status } : null;
}

export async function getCustomerTicketDownload({
  database,
  customerProfileId,
  ticketId,
  createDownloadUrl,
}: {
  database: PrismaClient;
  customerProfileId: string;
  ticketId: string;
  createDownloadUrl: (objectKey: string) => Promise<string>;
}): Promise<{ url: string } | null> {
  const documentJob = await database.ticketDocumentJob.findFirst({
    where: { ticketId, status: 'READY', ticket: { order: { customerProfileId, status: 'PAID' } } },
    select: { objectKey: true },
  });
  return documentJob ? { url: await createDownloadUrl(documentJob.objectKey) } : null;
}

export async function requestOrderConfirmationResend({
  database,
  customerProfileId,
  orderReference,
  idempotencyKey,
}: {
  database: PrismaClient;
  customerProfileId: string;
  orderReference: string;
  idempotencyKey?: string;
}): Promise<{ id: string } | null> {
  const order = await database.order.findFirst({
    where: { reference: orderReference, customerProfileId, status: 'PAID' },
    select: { id: true, buyerEmail: true },
  });
  if (!order) return null;
  const notification = await database.notificationJob.create({
    data: {
      orderId: order.id,
      type: 'ORDER_CONFIRMATION',
      recipientEmail: order.buyerEmail,
      idempotencyKey: idempotencyKey ?? `order:${order.id}:resend:${randomUUID()}`,
    },
    select: { id: true },
  });
  return notification;
}
