import type { PrismaClient } from '../generated/prisma/client.js';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { calculateCheckoutQuote } from './quote.js';

export async function quoteCheckout({
  database,
  eventId,
  items,
  now,
  holdTtlMs,
}: {
  database: PrismaClient;
  eventId: string;
  items: Array<{ ticketTypeId: string; quantity: number }>;
  now: Date;
  holdTtlMs: number;
}): Promise<{ ticketSubtotalKobo: number; platformFeeKobo: number; totalKobo: number; expiresAt: Date }> {
  if (!items.length || !Number.isSafeInteger(holdTtlMs) || holdTtlMs < 1) throw new RangeError('checkout quote is invalid');
  const event = await database.event.findFirst({
    where: { id: eventId, status: 'PUBLISHED', organizer: { status: 'ACTIVE' } },
    select: { startAt: true },
  });
  if (!event) throw new NotFoundException('event is unavailable for checkout');
  if (event.startAt <= now) throw new ConflictException('event sales are unavailable');
  const feeRule = await database.platformFeeRule.findFirst({
    where: { activeFrom: { lte: now }, OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
    select: { mode: true, percentageBasisPoints: true, fixedAmountKobo: true, appliesToFreeOrder: true },
  });
  if (!feeRule) throw new ServiceUnavailableException('no active platform fee rule');
  const ticketTypes = await database.ticketType.findMany({
    where: { id: { in: items.map((item) => item.ticketTypeId) }, eventId, isActive: true },
    select: { id: true, priceKobo: true, maxPerOrder: true, salesStartAt: true, salesEndAt: true },
  });
  if (ticketTypes.length !== items.length || new Set(items.map((item) => item.ticketTypeId)).size !== items.length) {
    throw new NotFoundException('one or more ticket types are unavailable');
  }
  const types = new Map(ticketTypes.map((ticketType) => [ticketType.id, ticketType]));
  for (const item of items) {
    const ticketType = types.get(item.ticketTypeId);
    if (!ticketType || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || (ticketType.maxPerOrder !== null && item.quantity > ticketType.maxPerOrder) || (ticketType.salesStartAt && ticketType.salesStartAt > now) || (ticketType.salesEndAt && ticketType.salesEndAt <= now)) {
      throw new ConflictException('ticket quantity is unavailable');
    }
  }
  const platformFeeRule = feeRule.mode === 'FIXED'
    ? { type: 'FIXED' as const, amountKobo: feeRule.fixedAmountKobo as number }
    : { type: 'PERCENTAGE' as const, basisPoints: feeRule.percentageBasisPoints as number };
  return {
    ...calculateCheckoutQuote({
      items: items.map((item) => ({ quantity: item.quantity, unitPriceKobo: types.get(item.ticketTypeId)?.priceKobo as number })),
      platformFeeRule,
      chargePlatformFeeOnFreeOrder: feeRule.appliesToFreeOrder,
    }),
    expiresAt: new Date(now.getTime() + holdTtlMs),
  };
}
