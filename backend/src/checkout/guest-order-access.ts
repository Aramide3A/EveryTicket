import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

export async function getGuestOrder({ database, orderReference, accessToken }: { database: PrismaClient; orderReference: string; accessToken: string }) {
  if (!accessToken) return null;
  return database.order.findFirst({
    where: { reference: orderReference, customerProfileId: null, guestAccessTokenDigest: digest(accessToken) },
    select: {
      reference: true,
      status: true,
      ticketSubtotalKobo: true,
      platformFeeKobo: true,
      totalKobo: true,
      event: { select: { title: true, slug: true, startAt: true, venue: true } },
      lines: { orderBy: { createdAt: 'asc' }, select: { ticketTypeName: true, unitPriceKobo: true, quantity: true } },
      tickets: { orderBy: { issuedAt: 'asc' }, select: { id: true, ticketTypeName: true, holderName: true, status: true, documentJob: { select: { status: true } } } },
    },
  });
}

export async function getGuestTicketDownload({ database, orderReference, ticketId, accessToken, createDownloadUrl }: { database: PrismaClient; orderReference: string; ticketId: string; accessToken: string; createDownloadUrl: (objectKey: string) => Promise<string> }): Promise<{ url: string } | null> {
  if (!accessToken) return null;
  const document = await database.ticketDocumentJob.findFirst({
    where: { ticketId, status: 'READY', ticket: { order: { reference: orderReference, customerProfileId: null, guestAccessTokenDigest: digest(accessToken) } } },
    select: { objectKey: true },
  });
  return document ? { url: await createDownloadUrl(document.objectKey) } : null;
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
