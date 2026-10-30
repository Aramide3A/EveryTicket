import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTicketCredential } from './ticket-credential.js';

type PrivatePdfStore = { putPrivatePdf(input: { objectKey: string; pdf: Uint8Array }): Promise<void> };

export async function processPendingTicketDocuments({
  database,
  objectStore,
  ticketCredentialSecret,
  now,
  maxAttempts = 5,
}: {
  database: PrismaClient;
  objectStore: PrivatePdfStore;
  ticketCredentialSecret: string;
  now: Date;
  maxAttempts?: number;
}): Promise<{ generated: number; failed: number }> {
  if (!ticketCredentialSecret || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('ticket document worker configuration is invalid');
  await database.ticketDocumentJob.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    data: { status: 'PENDING' },
  });
  const jobs = await database.ticketDocumentJob.findMany({
    where: { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      objectKey: true,
      attempts: true,
      ticket: { select: { id: true, holderName: true, ticketTypeName: true, admissionTokenDigest: true, event: { select: { title: true, startAt: true, venue: true, address: true } } } },
    },
  });
  let generated = 0;
  let failed = 0;
  for (const job of jobs) {
    const claimed = await database.ticketDocumentJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
    if (claimed.count !== 1) continue;
    try {
      const credential = createTicketCredential({ ticketId: job.ticket.id, admissionTokenDigest: job.ticket.admissionTokenDigest, secret: ticketCredentialSecret });
      await objectStore.putPrivatePdf({ objectKey: job.objectKey, pdf: await createTicketPdf({ ...job.ticket, credential }) });
      await database.ticketDocumentJob.update({ where: { id: job.id }, data: { status: 'READY', attempts: job.attempts + 1, nextAttemptAt: null, failureDetail: null } });
      generated += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const terminal = attempts >= maxAttempts;
      await database.ticketDocumentJob.update({
        where: { id: job.id },
        data: { status: terminal ? 'FAILED' : 'PENDING', attempts, nextAttemptAt: terminal ? null : new Date(now.getTime() + 60_000 * 2 ** (attempts - 1)), failureDetail: errorMessage(error) },
      });
      failed += 1;
    }
  }
  return { generated, failed };
}

async function createTicketPdf({
  id,
  holderName,
  ticketTypeName,
  event,
  credential,
}: {
  id: string;
  holderName: string;
  ticketTypeName: string;
  event: { title: string; startAt: Date; venue: string; address: string };
  credential: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('EverythingTicket', { x: 48, y: 784, size: 24, font: bold, color: rgb(0.11, 0.2, 0.34) });
  page.drawText(event.title, { x: 48, y: 730, size: 20, font: bold });
  const details = [
    `Holder: ${holderName}`,
    `Ticket: ${ticketTypeName}`,
    `Ticket code: ${id}`,
    `When: ${event.startAt.toISOString()}`,
    `Where: ${event.venue}, ${event.address}`,
  ];
  details.forEach((line, index) => page.drawText(line, { x: 48, y: 684 - index * 28, size: 12, font: regular }));
  page.drawText('Present this QR code at the gate.', { x: 48, y: 534, size: 12, font: regular });
  const qr = await pdf.embedPng(await QRCode.toDataURL(credential, { errorCorrectionLevel: 'M', margin: 1, width: 240 }));
  page.drawImage(qr, { x: 48, y: 270, width: 220, height: 220 });
  return pdf.save();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'ticket document delivery failed';
}
