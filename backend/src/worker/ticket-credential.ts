import { createHmac, timingSafeEqual } from 'node:crypto';

export function createTicketCredential({ ticketId, admissionTokenDigest, secret }: { ticketId: string; admissionTokenDigest: string; secret: string }): string {
  if (!ticketId || !admissionTokenDigest || !secret) throw new RangeError('ticket credential inputs are required');
  return `et1.${ticketId}.${signature(ticketId, admissionTokenDigest, secret)}`;
}

export function readTicketCredential({ token, admissionTokenDigest, secret }: { token: string; admissionTokenDigest: string; secret: string }): string | null {
  const match = /^et1\.([^.]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match || !admissionTokenDigest || !secret) return null;
  const [ticketId, provided] = [match[1], match[2]];
  const expected = signature(ticketId, admissionTokenDigest, secret);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? ticketId : null;
}

function signature(ticketId: string, admissionTokenDigest: string, secret: string): string {
  return createHmac('sha256', secret).update(`${ticketId}.${admissionTokenDigest}`).digest('base64url');
}
