import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/persistence/prisma-client.js';

type ReserveInventoryHold = (input: {
  database: ReturnType<typeof createDatabaseClient>;
  orderId: string;
  ticketTypeId: string;
  quantity: number;
  now: Date;
  expiresAt: Date;
}) => Promise<{ id: string; quantity: number }>;

async function loadReserveInventoryHold(): Promise<
  ReserveInventoryHold | undefined
> {
  try {
    const module = await import('../src/checkout/inventory-reservation.js');
    return module.reserveInventoryHold;
  } catch {
    return undefined;
  }
}

describe('inventory reservation', () => {
  const ids: Record<string, string | undefined> = {};
  let client: ReturnType<typeof createDatabaseClient> | undefined;

  afterEach(async () => {
    if (client) {
      if (ids.orderOneId || ids.orderTwoId) {
        await client.$executeRaw`
          DELETE FROM inventory_hold
          WHERE "orderId" IN (${ids.orderOneId ?? ''}, ${ids.orderTwoId ?? ''})
        `;
        await client.$executeRaw`
          DELETE FROM "order"
          WHERE id IN (${ids.orderOneId ?? ''}, ${ids.orderTwoId ?? ''})
        `;
      }
      if (ids.feeRuleId) {
        await client.$executeRaw`
          DELETE FROM platform_fee_rule WHERE id = ${ids.feeRuleId}
        `;
      }
      if (ids.ticketTypeId) {
        await client.$executeRaw`
          DELETE FROM ticket_type WHERE id = ${ids.ticketTypeId}
        `;
      }
      if (ids.eventId) {
        await client.$executeRaw`
          DELETE FROM event WHERE id = ${ids.eventId}
        `;
      }
      if (ids.categoryId) {
        await client.$executeRaw`
          DELETE FROM event_category WHERE id = ${ids.categoryId}
        `;
      }
      if (ids.userId) {
        await client.$executeRaw`
          DELETE FROM auth_user WHERE id = ${ids.userId}
        `;
      }
      await client.$disconnect();
    }
    Object.keys(ids).forEach((key) => delete ids[key]);
    client = undefined;
  });

  it('allows only one concurrent reservation for the final available ticket', async () => {
    const reserveInventoryHold = await loadReserveInventoryHold();
    const databaseUrl = process.env.DATABASE_URL;

    expect(reserveInventoryHold).toBeDefined();
    if (!reserveInventoryHold || !databaseUrl) {
      throw new Error('inventory reservation dependencies are unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();
    await createCheckoutFixture(client, ids);

    const now = new Date('2031-01-01T10:00:00.000Z');
    const results = await Promise.allSettled([
      reserveInventoryHold({
        database: client,
        orderId: ids.orderOneId as string,
        ticketTypeId: ids.ticketTypeId as string,
        quantity: 1,
        now,
        expiresAt: new Date('2031-01-01T10:10:00.000Z'),
      }),
      reserveInventoryHold({
        database: client,
        orderId: ids.orderTwoId as string,
        ticketTypeId: ids.ticketTypeId as string,
        quantity: 1,
        now,
        expiresAt: new Date('2031-01-01T10:10:00.000Z'),
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const holds = await client.$queryRaw<{ quantity: number }[]>`
      SELECT quantity FROM inventory_hold WHERE "ticketTypeId" = ${ids.ticketTypeId}
    `;
    expect(holds).toEqual([{ quantity: 1 }]);
  });
});

async function createCheckoutFixture(
  client: ReturnType<typeof createDatabaseClient>,
  ids: Record<string, string | undefined>,
): Promise<void> {
  ids.userId = randomUUID();
  ids.categoryId = randomUUID();
  ids.eventId = randomUUID();
  ids.profileId = randomUUID();
  ids.ticketTypeId = randomUUID();
  ids.feeRuleId = randomUUID();
  ids.orderOneId = randomUUID();
  ids.orderTwoId = randomUUID();

  await client.$executeRaw`
    INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (${ids.userId}, 'Test organizer', ${`${ids.userId}@example.test`}, false, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt")
    VALUES (${ids.profileId}, ${ids.userId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt")
    VALUES (${ids.categoryId}, ${`Music ${ids.categoryId}`}, ${`music-${ids.categoryId}`}, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO event (
      id, "organizerProfileId", "categoryId", title, slug, description,
      city, state, venue, address, "timeZone", "startAt", "endAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${ids.eventId}, ${ids.profileId}, ${ids.categoryId}, 'Test event',
      ${`test-event-${ids.eventId}`}, 'Test description', 'Lagos', 'Lagos',
      'Test venue', 'Test address', 'Africa/Lagos', NOW(), NOW() + INTERVAL '1 hour', NOW(), NOW()
    )
  `;
  await client.$executeRaw`
    INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt")
    VALUES (${ids.ticketTypeId}, ${ids.eventId}, 'General admission', 1500, 1, true, NOW(), NOW())
  `;
  await client.$executeRaw`
    INSERT INTO platform_fee_rule (
      id, version, mode, "fixedAmountKobo", "activeFrom", "appliesToFreeOrder", "createdAt"
    )
    VALUES (${ids.feeRuleId}, 1, 'FIXED', 0, NOW(), false, NOW())
  `;
  for (const [id, reference] of [
    [ids.orderOneId, `ET-${randomUUID()}`],
    [ids.orderTwoId, `ET-${randomUUID()}`],
  ]) {
    await client.$executeRaw`
      INSERT INTO "order" (
        id, reference, "eventId", "buyerName", "buyerEmail", currency,
        "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId",
        "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo",
        status, "holdExpiresAt", "createdAt"
      )
      VALUES (
        ${id}, ${reference}, ${ids.eventId}, 'Test buyer', 'buyer@example.test', 'NGN',
        1500, 0, 1500, ${ids.feeRuleId}, 1, 'FIXED', 0, 'PENDING_PAYMENT',
        NOW() + INTERVAL '10 minutes', NOW()
      )
    `;
  }
}
