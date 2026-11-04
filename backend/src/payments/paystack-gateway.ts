const PAYSTACK_API_URL = 'https://api.paystack.co';

type PaystackResponse = {
  status: boolean;
  message?: string;
  data?: unknown;
};

export type PaystackVerification = {
  reference: string;
  gatewayTransactionId: string;
  status: 'success' | 'failed' | 'pending';
  amountKobo: number;
  currency: string;
  paidAt?: Date;
};

export type PaystackRefund = {
  reference: string;
  status: 'pending' | 'processing' | 'needs-attention' | 'failed' | 'processed';
  amountKobo: number;
  currency: string;
};

export type PaymentGateway = {
  initializeTransaction(input: {
    reference: string;
    email: string;
    amountKobo: number;
    currency: string;
  }): Promise<{ authorizationUrl: string; accessCode: string }>;
  verifyTransaction(reference: string): Promise<PaystackVerification>;
};

export type RefundGateway = {
  createRefund(input: {
    transactionReference: string;
    amountKobo: number;
    currency: string;
    customerNote: string;
    merchantNote: string;
  }): Promise<PaystackRefund>;
  fetchRefund(reference: string): Promise<PaystackRefund>;
};

export type PaystackGateway = PaymentGateway & RefundGateway;

export function createPaystackGateway({
  secretKey,
  fetchFn = fetch,
}: {
  secretKey: string;
  fetchFn?: typeof fetch;
}): PaystackGateway {
  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is required');
  }

  return {
    async initializeTransaction({ reference, email, amountKobo, currency }) {
      const response = await request(fetchFn, '/transaction/initialize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, amount: amountKobo, currency, reference }),
      }, secretKey);
      const data = readRecord(response.data, 'Paystack initialization response');
      const authorizationUrl = readString(data.authorization_url, 'authorization_url');
      const accessCode = readString(data.access_code, 'access_code');

      return { authorizationUrl, accessCode };
    },

    async verifyTransaction(reference) {
      const response = await request(
        fetchFn,
        `/transaction/verify/${encodeURIComponent(reference)}`,
        {},
        secretKey,
      );
      const data = readRecord(response.data, 'Paystack verification response');
      const status = readPaymentStatus(data.status);
      const paidAt = data.paid_at === null || data.paid_at === undefined
        ? undefined
        : readDate(data.paid_at, 'paid_at');

      return {
        reference: readString(data.reference, 'reference'),
        gatewayTransactionId: String(data.id),
        status,
        amountKobo: readInteger(data.amount, 'amount'),
        currency: readString(data.currency, 'currency'),
        ...(paidAt ? { paidAt } : {}),
      };
    },

    async createRefund({ transactionReference, amountKobo, currency, customerNote, merchantNote }) {
      const response = await request(fetchFn, '/refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transaction: transactionReference,
          amount: amountKobo,
          currency,
          customer_note: customerNote,
          merchant_note: merchantNote,
        }),
      }, secretKey);
      const data = readRecord(response.data, 'Paystack refund response');
      return readPaystackRefund(data);
    },

    async fetchRefund(reference) {
      const response = await request(fetchFn, `/refund/${encodeURIComponent(reference)}`, {}, secretKey);
      return readPaystackRefund(readRecord(response.data, 'Paystack refund response'));
    },
  };
}

async function request(
  fetchFn: typeof fetch,
  path: string,
  init: RequestInit,
  secretKey: string,
): Promise<PaystackResponse> {
  const response = await fetchFn(`${PAYSTACK_API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey}`, ...init.headers },
  });
  const payload: unknown = await response.json().catch(() => undefined);
  const parsed = readRecord(payload, 'Paystack response') as PaystackResponse;
  if (!response.ok || parsed.status !== true) {
    throw new Error(parsed.message ?? 'Paystack request failed');
  }
  return parsed;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Paystack ${label} is invalid`);
  }
  return value;
}

function readInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Paystack ${label} is invalid`);
  }
  return value;
}

function readIdentifier(value: unknown, label: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    throw new Error(`Paystack ${label} is invalid`);
  }
  return String(value);
}

function readPaymentStatus(value: unknown): 'success' | 'failed' | 'pending' {
  if (value === 'success' || value === 'failed' || value === 'pending') {
    return value;
  }
  throw new Error('Paystack status is invalid');
}

function readRefundStatus(value: unknown): PaystackRefund['status'] {
  if (value === 'pending' || value === 'processing' || value === 'needs-attention' || value === 'failed' || value === 'processed') {
    return value;
  }
  throw new Error('Paystack refund status is invalid');
}

function readPaystackRefund(data: Record<string, unknown>): PaystackRefund {
  return {
    reference: readIdentifier(data.id, 'refund id'),
    status: readRefundStatus(data.status),
    amountKobo: readInteger(data.amount, 'amount'),
    currency: readString(data.currency, 'currency'),
  };
}

function readDate(value: unknown, label: string): Date {
  if (typeof value !== 'string') {
    throw new Error(`Paystack ${label} is invalid`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Paystack ${label} is invalid`);
  }
  return date;
}
