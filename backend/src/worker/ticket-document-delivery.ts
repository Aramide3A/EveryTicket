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
      ticket: {
        select: {
          id: true,
          holderName: true,
          holderEmail: true,
          priceKobo: true,
          ticketTypeName: true,
          admissionTokenDigest: true,
          order: { select: { reference: true } },
          event: { select: { title: true, startAt: true, venue: true, address: true } },
        },
      },
    },
  });
  let generated = 0;
  let failed = 0;
  for (const job of jobs) {
    const claimed = await database.ticketDocumentJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
    if (claimed.count !== 1) continue;
    try {
      const credential = createTicketCredential({ ticketId: job.ticket.id, admissionTokenDigest: job.ticket.admissionTokenDigest, secret: ticketCredentialSecret });
      await objectStore.putPrivatePdf({
        objectKey: job.objectKey,
        pdf: await createTicketPdf({
          ...job.ticket,
          orderReference: job.ticket.order.reference,
          credential,
        }),
      });
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

export async function createTicketPdf({
  id,
  holderEmail,
  holderName,
  orderReference,
  priceKobo,
  ticketTypeName,
  event,
  credential,
}: {
  id: string;
  holderEmail: string;
  holderName: string;
  orderReference: string;
  priceKobo: number;
  ticketTypeName: string;
  event: { title: string; startAt: Date; venue: string; address: string };
  credential: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const plum = rgb(0.21, 0, 0.31);
  const purple = rgb(0.34, 0, 0.47);
  const violet = rgb(0.46, 0.07, 0.64);
  const paper = rgb(1, 0.992, 0.973);
  const muted = rgb(0.43, 0.41, 0.47);
  const line = rgb(0.89, 0.88, 0.9);
  const paidAmount = `NGN ${(priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const date = new Intl.DateTimeFormat('en-NG', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(event.startAt);
  const time = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' }).format(event.startAt);
  const margin = 58;
  const width = 479;

  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: paper });
  page.drawRectangle({ x: margin, y: 130, width, height: 580, color: rgb(1, 1, 1), borderColor: line, borderWidth: 1 });
  page.drawRectangle({ x: margin, y: 650, width, height: 60, color: purple });
  page.drawText('EverythingTicket | Entry Pass', { x: 82, y: 674, size: 18, font: regular, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 411, y: 665, width: 103, height: 24, color: violet });
  page.drawText('OFFICIAL E-TICKET', { x: 420, y: 673, size: 8, font: bold, color: rgb(1, 1, 1) });
  page.drawText(fitText(event.title, bold, 24, 390), { x: 82, y: 602, size: fitSize(event.title, bold, 24, 390), font: bold, color: plum });

  drawLabel(page, regular, 'DATE & TIME', 82, 558, muted);
  page.drawText(date, { x: 82, y: 542, size: 12, font: bold, color: plum });
  page.drawText(`Doors open ${time}`, { x: 82, y: 526, size: 10, font: regular, color: muted });
  drawLabel(page, regular, 'VENUE & LOCATION', 305, 558, muted);
  page.drawText(fitText(event.venue, bold, 12, 205), { x: 305, y: 542, size: fitSize(event.venue, bold, 12, 205), font: bold, color: plum });
  page.drawText(fitText(event.address, regular, 10, 205), { x: 305, y: 526, size: fitSize(event.address, regular, 10, 205), font: regular, color: muted });
  page.drawLine({ start: { x: 82, y: 505 }, end: { x: 513, y: 505 }, thickness: 1, color: line });

  drawLabel(page, regular, 'ATTENDEE NAME', 82, 467, muted);
  page.drawText(fitText(holderName, bold, 13, 190), { x: 82, y: 451, size: fitSize(holderName, bold, 13, 190), font: bold, color: plum });
  page.drawText(fitText(holderEmail, regular, 10, 190), { x: 82, y: 435, size: fitSize(holderEmail, regular, 10, 190), font: regular, color: muted });
  drawLabel(page, regular, 'TICKET TYPE', 305, 467, muted);
  page.drawRectangle({ x: 305, y: 436, width: 146, height: 23, color: rgb(0.93, 0.89, 1) });
  page.drawText(fitText(ticketTypeName, regular, 11, 132), { x: 312, y: 443, size: fitSize(ticketTypeName, regular, 11, 132), font: regular, color: violet });
  page.drawText(`Paid: ${paidAmount}`, { x: 305, y: 421, size: 10, font: regular, color: muted });
  page.drawLine({ start: { x: 82, y: 402 }, end: { x: 513, y: 402 }, thickness: 1, color: line });

  page.drawRectangle({ x: 82, y: 204, width: 431, height: 168, color: rgb(0.985, 0.982, 0.99), borderColor: line, borderWidth: 1 });
  const qr = await pdf.embedPng(await QRCode.toDataURL(credential, { errorCorrectionLevel: 'M', margin: 1, width: 240 }));
  page.drawImage(qr, { x: 100, y: 222, width: 130, height: 130 });
  drawLabel(page, regular, 'TICKET CODE', 254, 326, muted);
  page.drawText(id, { x: 254, y: 305, size: 18, font: regular, color: violet });
  page.drawText('Present this cryptographic QR code at the venue gate.', { x: 254, y: 279, size: 9, font: regular, color: muted });
  page.drawText('Scanned in real time with the organizer camera scanner.', { x: 254, y: 264, size: 9, font: regular, color: muted });
  page.drawText('Valid for ONE entry only. Duplicates will be rejected.', { x: 254, y: 249, size: 9, font: regular, color: muted });
  page.drawLine({ start: { x: margin, y: 164 }, end: { x: margin + width, y: 164 }, thickness: 1, color: line });
  page.drawText(`Order Ref: ${orderReference}`, { x: 82, y: 143, size: 9, font: regular, color: muted });
  page.drawText('Powered by EveryTicket', { x: 405, y: 143, size: 9, font: regular, color: muted });
  return pdf.save();
}

function drawLabel(page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont, label: string, x: number, y: number, color: ReturnType<typeof rgb>): void {
  page.drawText(label, { x, y, size: 9, font, color });
}

function fitSize(text: string, font: import('pdf-lib').PDFFont, size: number, width: number): number {
  return font.widthOfTextAtSize(text, size) <= width ? size : Math.max(8, (width / font.widthOfTextAtSize(text, size)) * size);
}

function fitText(text: string, font: import('pdf-lib').PDFFont, size: number, width: number): string {
  return font.widthOfTextAtSize(text, size) <= width ? text : `${text.slice(0, Math.max(1, Math.floor((text.length * width) / font.widthOfTextAtSize(text, size)) - 3))}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'ticket document delivery failed';
}
