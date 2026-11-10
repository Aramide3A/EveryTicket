import type { PrismaClient } from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { createTicketCredential } from '../worker/ticket-credential.js';

export const customerOrderStatuses = ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID_NEEDS_RESOLUTION'] as const;
export type CustomerOrderStatus = typeof customerOrderStatuses[number];

export async function listCustomerOrders({
  database,
  customerProfileId,
  status,
  page = 1,
  pageSize = 20,
}: {
  database: PrismaClient;
  customerProfileId: string;
  status?: CustomerOrderStatus;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: Array<{
    reference: string;
    status: string;
    createdAt: Date;
    event: { title: string; startAt: Date; venue: string };
    lines: Array<{ ticketTypeName: string; quantity: number }>;
    tickets: Array<{ id: string; ticketTypeName: string }>;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('order history pagination is invalid');
  const where = { customerProfileId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    database.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        reference: true,
        status: true,
        createdAt: true,
        event: { select: { title: true, startAt: true, venue: true } },
        lines: { select: { ticketTypeName: true, quantity: true }, orderBy: { createdAt: 'asc' } },
        tickets: { select: { id: true, ticketTypeName: true }, orderBy: { issuedAt: 'asc' } },
      },
    }),
    database.order.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function getCustomerOrder({
  database,
  customerProfileId,
  orderReference,
}: {
  database: PrismaClient;
  customerProfileId: string;
  orderReference: string;
}): Promise<{
  reference: string;
  status: string;
  createdAt: Date;
  ticketSubtotalKobo: number;
  platformFeeKobo: number;
  totalKobo: number;
  event: { title: string; startAt: Date; venue: string };
  lines: Array<{ ticketTypeName: string; quantity: number }>;
  tickets: Array<{ id: string; ticketTypeName: string }>;
} | null> {
  return database.order.findFirst({
    where: { reference: orderReference, customerProfileId },
    select: {
      reference: true,
      status: true,
      createdAt: true,
      ticketSubtotalKobo: true,
      platformFeeKobo: true,
      totalKobo: true,
      event: { select: { title: true, startAt: true, venue: true } },
      lines: { select: { ticketTypeName: true, quantity: true }, orderBy: { createdAt: 'asc' } },
      tickets: { select: { id: true, ticketTypeName: true }, orderBy: { issuedAt: 'asc' } },
    },
  });
}

export async function listCustomerTickets({
  database,
  customerProfileId,
  admissionTokenSecret,
}: {
  database: PrismaClient;
  customerProfileId: string;
  admissionTokenSecret: string;
}): Promise<CustomerTicketView[]> {
  const tickets = await database.ticket.findMany({
    where: { order: { customerProfileId, status: 'PAID' } },
    orderBy: { issuedAt: 'desc' },
    select: customerTicketSelect,
  });
  return tickets.map((ticket) => customerTicketView(ticket, admissionTokenSecret));
}

export async function getCustomerTicket({
  database,
  customerProfileId,
  ticketId,
  admissionTokenSecret,
}: {
  database: PrismaClient;
  customerProfileId: string;
  ticketId: string;
  admissionTokenSecret: string;
}): Promise<CustomerTicketView | null> {
  const ticket = await database.ticket.findFirst({
    where: { id: ticketId, order: { customerProfileId, status: 'PAID' } },
    select: customerTicketSelect,
  });
  return ticket ? customerTicketView(ticket, admissionTokenSecret) : null;
}

const customerTicketSelect = {
  id: true,
  ticketTypeName: true,
  holderName: true,
  holderEmail: true,
  status: true,
  admissionTokenDigest: true,
  checkIn: { select: { id: true } },
  order: { select: { reference: true } },
  event: { select: { id: true, title: true, slug: true, startAt: true, endAt: true, venue: true, address: true, timeZone: true } },
} as const;

type CustomerTicketRecord = {
  id: string;
  ticketTypeName: string;
  holderName: string;
  holderEmail: string;
  status: string;
  admissionTokenDigest: string;
  checkIn: { id: string } | null;
  order: { reference: string };
  event: { id: string; title: string; slug: string; startAt: Date; endAt: Date; venue: string; address: string; timeZone: string };
};

type CustomerTicketView = Omit<CustomerTicketRecord, 'admissionTokenDigest' | 'checkIn' | 'order'> & { orderReference: string; checkedIn: boolean; admissionCredential: string };

function customerTicketView(ticket: CustomerTicketRecord, admissionTokenSecret: string): CustomerTicketView {
  return {
    id: ticket.id,
    ticketTypeName: ticket.ticketTypeName,
    holderName: ticket.holderName,
    holderEmail: ticket.holderEmail,
    status: ticket.status,
    event: ticket.event,
    orderReference: ticket.order.reference,
    checkedIn: ticket.checkIn !== null,
    admissionCredential: createTicketCredential({ ticketId: ticket.id, admissionTokenDigest: ticket.admissionTokenDigest, secret: admissionTokenSecret }),
  };
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
