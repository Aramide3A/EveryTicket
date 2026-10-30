import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaystackSignature({
  rawBody,
  signature,
  secret,
}: {
  rawBody: Buffer;
  signature: string;
  secret: string;
}): boolean {
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');

  return received.length === expected.length && timingSafeEqual(received, expected);
}
