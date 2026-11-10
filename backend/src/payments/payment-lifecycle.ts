import type { PrismaClient } from '../generated/prisma/client.js';
import { finalizePaidOrder } from './finalize-paid-order.js';
import type { PaymentGateway } from './paystack-gateway.js';

export async function initializePayment({
  database,
  gateway,
  orderReference,
  paymentReference,
  now,
}: {
  database: PrismaClient;
  gateway: PaymentGateway;
  orderReference: string;
  paymentReference: string;
  now: Date;
}): Promise<{ reference: string; authorizationUrl: string; accessCode: string }> {
  const attempt = await database.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { reference: orderReference },
      select: { id: true, buyerEmail: true, currency: true, status: true, totalKobo: true, paystackChargeKobo: true },
    });
    if (!order) {
      throw new Error('order was not found');
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new Error('order cannot accept a payment');
    }
    return transaction.paymentAttempt.create({
      data: {
        orderId: order.id,
        reference: paymentReference,
        expectedAmountKobo: order.paystackChargeKobo || order.totalKobo,
        currency: order.currency,
      },
      select: { reference: true, expectedAmountKobo: true, currency: true, order: { select: { buyerEmail: true, totalKobo: true, paystackChargeKobo: true } } },
    });
  });

  try {
    const authorization = await gateway.initializeTransaction({
      reference: attempt.reference,
      email: attempt.order.buyerEmail,
      amountKobo: orderTotalKobo(attempt.expectedAmountKobo, attempt.order.paystackChargeKobo, attempt.order.totalKobo),
      currency: attempt.currency,
    });
    await database.paymentAttempt.update({
      where: { reference: attempt.reference },
      data: { initializedAt: now },
    });
    return { reference: attempt.reference, ...authorization };
  } catch (error) {
    await database.paymentAttempt.update({
      where: { reference: attempt.reference },
      data: { failureDetail: errorMessage(error) },
    });
    throw error;
  }
}

function orderTotalKobo(expectedAmountKobo: number, paystackChargeKobo: number, totalKobo: number): number {
  return paystackChargeKobo > 0 && paystackChargeKobo === expectedAmountKobo ? totalKobo : expectedAmountKobo;
}

export async function processVerifiedPayment({
  database,
  gateway,
  paymentReference,
  now,
}: {
  database: PrismaClient;
  gateway: PaymentGateway;
  paymentReference: string;
  now: Date;
}): Promise<
  | { orderStatus: 'PAID'; ticketsIssued: number }
  | { orderStatus: 'PENDING_PAYMENT' }
  | { orderStatus: 'PAID_NEEDS_RESOLUTION'; ticketsIssued: 0 }
> {
  const attempt = await database.paymentAttempt.findUnique({
    where: { reference: paymentReference },
    select: { expectedAmountKobo: true, currency: true },
  });
  if (!attempt) {
    throw new Error('payment attempt was not found');
  }

  const verified = await gateway.verifyTransaction(paymentReference);
  if (verified.reference !== paymentReference) {
    await flagPaymentForResolution(database, paymentReference, 'gateway reference does not match payment attempt');
    throw new Error('verified payment reference does not match');
  }
  if (verified.amountKobo !== attempt.expectedAmountKobo || verified.currency !== attempt.currency) {
    await flagPaymentForResolution(database, paymentReference, 'gateway amount or currency does not match payment attempt');
    throw new Error('verified payment amount or currency does not match');
  }
  if (verified.status === 'pending') {
    return { orderStatus: 'PENDING_PAYMENT' };
  }
  if (verified.status === 'failed') {
    await database.paymentAttempt.update({
      where: { reference: paymentReference },
      data: { status: 'VERIFIED_FAILED', failureDetail: 'Paystack reported a failed payment', verifiedAt: now },
    });
    return { orderStatus: 'PENDING_PAYMENT' };
  }
  return finalizePaidOrder({
    database,
    paymentReference,
    gatewayTransactionId: verified.gatewayTransactionId,
    paidAt: verified.paidAt ?? now,
  });
}

export async function reconcilePendingPayments({
  database,
  gateway,
  now,
}: {
  database: PrismaClient;
  gateway: PaymentGateway;
  now: Date;
}): Promise<{ checked: number; paid: number; needsResolution: number }> {
  const attempts = await database.paymentAttempt.findMany({
    where: { status: 'INITIALIZED', order: { status: 'PENDING_PAYMENT' } },
    select: { reference: true },
  });
  let paid = 0;
  let needsResolution = 0;

  for (const attempt of attempts) {
    try {
      const result = await processVerifiedPayment({
        database,
        gateway,
        paymentReference: attempt.reference,
        now,
      });
      if (result.orderStatus === 'PAID') {
        paid += 1;
      }
      if (result.orderStatus === 'PAID_NEEDS_RESOLUTION') {
        needsResolution += 1;
      }
    } catch (error) {
      const current = await database.paymentAttempt.findUnique({
        where: { reference: attempt.reference },
        select: { order: { select: { status: true } } },
      });
      if (current?.order.status === 'PAID_NEEDS_RESOLUTION') {
        needsResolution += 1;
        continue;
      }
      throw error;
    }
  }
  return { checked: attempts.length, paid, needsResolution };
}

async function flagPaymentForResolution(
  database: PrismaClient,
  paymentReference: string,
  failureDetail: string,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    const attempt = await transaction.paymentAttempt.update({
      where: { reference: paymentReference },
      data: { status: 'VERIFIED_FAILED', failureDetail, verifiedAt: new Date() },
      select: { orderId: true },
    });
    await transaction.order.update({
      where: { id: attempt.orderId },
      data: { status: 'PAID_NEEDS_RESOLUTION' },
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Paystack initialization failed';
}
