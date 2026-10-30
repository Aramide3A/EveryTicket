import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

export async function finalizePaidOrder({
  database,
  paymentReference,
  gatewayTransactionId,
  paidAt,
}: {
  database: PrismaClient;
  paymentReference: string;
  gatewayTransactionId: string;
  paidAt: Date;
}): Promise<
  | { orderStatus: 'PAID'; ticketsIssued: number }
  | { orderStatus: 'PAID_NEEDS_RESOLUTION'; ticketsIssued: 0 }
> {
  return database.$transaction(async (transaction) => {
    const lockedOrders = await transaction.$queryRaw<{
      id: string;
      status: string;
      eventId: string;
      buyerName: string;
      buyerEmail: string;
    }[]>`
      SELECT "order".id, "order".status::text, "order"."eventId", "order"."buyerName", "order"."buyerEmail"
      FROM "order"
      JOIN payment_attempt ON payment_attempt."orderId" = "order".id
      WHERE payment_attempt.reference = ${paymentReference}
      FOR UPDATE OF "order"
    `;
    const order = lockedOrders[0];
    if (!order) {
      throw new Error('payment attempt was not found');
    }

    const existingTickets = await transaction.ticket.count({
      where: { orderId: order.id },
    });
    if (order.status === 'PAID') {
      return { orderStatus: 'PAID', ticketsIssued: existingTickets };
    }
    if (order.status === 'PAID_NEEDS_RESOLUTION') {
      return { orderStatus: 'PAID_NEEDS_RESOLUTION', ticketsIssued: 0 };
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new Error('order cannot be finalized');
    }

    const [attempt, lines, holds] = await Promise.all([
      transaction.paymentAttempt.findUniqueOrThrow({
        where: { reference: paymentReference },
        select: { id: true },
      }),
      transaction.orderLine.findMany({
        where: { orderId: order.id },
        select: {
          ticketTypeId: true,
          ticketTypeName: true,
          unitPriceKobo: true,
          quantity: true,
        },
      }),
      transaction.inventoryHold.findMany({
        where: { orderId: order.id },
        select: { ticketTypeId: true, quantity: true, expiresAt: true },
      }),
    ]);

    const holdsAreValid =
      holds.length === lines.length &&
      lines.every((line) =>
        holds.some(
          (hold) =>
            hold.ticketTypeId === line.ticketTypeId &&
            hold.quantity === line.quantity &&
            hold.expiresAt > paidAt,
        ),
      );
    if (!holdsAreValid) {
      await transaction.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'VERIFIED_SUCCESS',
          gatewayTransactionId,
          verifiedAt: paidAt,
          failureDetail: 'Payment arrived after the inventory hold expired or was unavailable',
        },
      });
      await transaction.inventoryHold.deleteMany({ where: { orderId: order.id } });
      await transaction.order.update({
        where: { id: order.id },
        data: { status: 'PAID_NEEDS_RESOLUTION' },
      });
      return { orderStatus: 'PAID_NEEDS_RESOLUTION', ticketsIssued: 0 };
    }

    await transaction.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'VERIFIED_SUCCESS',
        gatewayTransactionId,
        verifiedAt: paidAt,
      },
    });
    const tickets = lines.flatMap((line) =>
        Array.from({ length: line.quantity }, () => ({
          id: randomUUID(),
          orderId: order.id,
          eventId: order.eventId,
          ticketTypeId: line.ticketTypeId,
          holderName: order.buyerName,
          holderEmail: order.buyerEmail,
          ticketTypeName: line.ticketTypeName,
          priceKobo: line.unitPriceKobo,
          admissionTokenDigest: createHash('sha256')
            .update(randomUUID())
            .digest('hex'),
        })),
      );
    await transaction.ticket.createMany({ data: tickets });
    await transaction.ticketDocumentJob.createMany({
      data: tickets.map((ticket) => ({ ticketId: ticket.id, objectKey: `tickets/${ticket.id}.pdf` })),
    });
    await transaction.notificationJob.create({
      data: {
        orderId: order.id,
        type: 'ORDER_CONFIRMATION',
        recipientEmail: order.buyerEmail,
        idempotencyKey: `order:${order.id}:confirmation`,
      },
    });
    await transaction.inventoryHold.deleteMany({ where: { orderId: order.id } });
    await transaction.order.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt },
    });
    return { orderStatus: 'PAID', ticketsIssued: lines.reduce((sum, line) => sum + line.quantity, 0) };
  });
}

