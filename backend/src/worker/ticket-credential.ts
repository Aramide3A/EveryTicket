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

export function createGuestCredential({ guestId, admissionTokenDigest, secret }: { guestId: string; admissionTokenDigest: string; secret: string }): string {
  if (!guestId || !admissionTokenDigest || !secret) throw new RangeError('guest credential inputs are required');
  return `eg1.${guestId}.${guestSignature(guestId, admissionTokenDigest, secret)}`;
}

export function readGuestCredential({ token, admissionTokenDigest, secret }: { token: string; admissionTokenDigest: string; secret: string }): string | null {
  const match = /^eg1\.([^.]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match || !admissionTokenDigest || !secret) return null;
  const [guestId, provided] = [match[1], match[2]];
  const expected = guestSignature(guestId, admissionTokenDigest, secret);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? guestId : null;
}

function signature(ticketId: string, admissionTokenDigest: string, secret: string): string {
  return createHmac('sha256', secret).update(`${ticketId}.${admissionTokenDigest}`).digest('base64url');
}

function guestSignature(guestId: string, admissionTokenDigest: string, secret: string): string {
  return createHmac('sha256', secret).update(`guest.${guestId}.${admissionTokenDigest}`).digest('base64url');
}
