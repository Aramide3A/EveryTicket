import { inflateSync } from 'node:zlib';
import { createTicketPdf } from '../src/worker/ticket-document-delivery.js';

describe('ticket PDF rendering', () => {
  it('creates an A4 entry pass with the core gate information', async () => {
    const pdf = await createTicketPdf({
      id: 'ET-LAG-7A9B',
      holderName: 'Chioma Adeleke',
      holderEmail: 'chioma.adeleke@example.com',
      ticketTypeName: 'VIP Access Pass',
      priceKobo: 3_500_000,
      orderReference: 'ET_1790021001_A9B8C1',
      event: {
        title: 'Afrobeats Summer Wave 2026',
        startAt: new Date('2026-10-22T08:00:00.000Z'),
        venue: 'Eko Atlantic City Ground',
        address: 'Eko Atlantic City Ground, Lagos',
      },
      credential: 'private-signed-credential',
    });

    const content = allPdfStreams(pdf);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe('%PDF');
    for (const text of [
      'EverythingTicket | Entry Pass',
      'OFFICIAL E-TICKET',
      'Afrobeats Summer Wave 2026',
      'ATTENDEE NAME',
      'TICKET TYPE',
      'TICKET CODE',
      'ET-LAG-7A9B',
      'Order Ref: ET_1790021001_A9B8C1',
    ])
      expect(content).toContain(Buffer.from(text).toString('hex').toUpperCase());
  });
});

function allPdfStreams(pdf: Uint8Array): string {
  const bytes = Buffer.from(pdf);
  const streams: string[] = [];
  let start = 0;
  while (start >= 0) {
    const streamStart = bytes.indexOf(Buffer.from('stream\n'), start);
    if (streamStart < 0) break;
    const contentStart = streamStart + 'stream\n'.length;
    const streamEnd = bytes.indexOf(Buffer.from('\nendstream'), contentStart);
    if (streamEnd < 0) break;
    try {
      streams.push(inflateSync(bytes.subarray(contentStart, streamEnd)).toString('latin1').toUpperCase());
    } catch {
      // PDF image streams are not text content.
    }
    start = streamEnd + '\nendstream'.length;
  }
  return streams.join('\n');
}
