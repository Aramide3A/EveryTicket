import { verifyPaystackSignature } from './paystack-signature.js';

export async function handlePaystackWebhook({
  rawBody,
  signature,
  secret,
  onChargeSuccess,
}: {
  rawBody: Buffer;
  signature: string | undefined;
  secret: string;
  onChargeSuccess(reference: string): Promise<void>;
}): Promise<{ accepted: boolean }> {
  if (!signature || !verifyPaystackSignature({ rawBody, signature, secret })) {
    throw new Error('webhook signature is invalid');
  }
  const payload = parsePayload(rawBody);
  if (payload.event === 'charge.success') {
    const reference = readReference(payload.data);
    await onChargeSuccess(reference);
  }
  return { accepted: true };
}

function parsePayload(rawBody: Buffer): { event: unknown; data: unknown } {
  try {
    const payload: unknown = JSON.parse(rawBody.toString('utf8'));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error();
    }
    const { event, data } = payload as Record<string, unknown>;
    return { event, data };
  } catch {
    throw new Error('webhook payload is invalid');
  }
}

function readReference(data: unknown): string {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('webhook payment reference is invalid');
  }
  const reference = (data as Record<string, unknown>).reference;
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new Error('webhook payment reference is invalid');
  }
  return reference;
}
