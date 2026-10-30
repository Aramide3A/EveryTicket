import { randomUUID } from 'node:crypto';

type DatabaseClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $executeRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

type DatabaseClientFactory = (databaseUrl: string) => DatabaseClient;

type AuthFactory = (options: {
  baseUrl: string;
  databaseClient?: DatabaseClient;
  databaseUrl: string;
  secret: string;
}) => {
  api: {
    signUpEmail(options: {
      body: { email: string; name: string; password: string };
    }): Promise<{ user: { email: string; id: string } }>;
  };
};

async function loadDatabaseClientFactory(): Promise<
  DatabaseClientFactory | undefined
> {
  try {
    const modulePath = '../src/persistence/prisma-client.js';
    return (
      (await import(modulePath)) as {
        createDatabaseClient: DatabaseClientFactory;
      }
    ).createDatabaseClient;
  } catch (error) {
    if (
      String(error).includes(
        "Cannot find module '../src/persistence/prisma-client.js'"
      )
    ) {
      return undefined;
    }

    throw error;
  }
}

async function loadAuthFactory(): Promise<AuthFactory | undefined> {
  try {
    const modulePath = '../src/identity/auth.js';
    return ((await import(modulePath)) as { createAuth: AuthFactory }).createAuth;
  } catch (error) {
    if (String(error).includes("Cannot find module '../src/identity/auth.js'")) {
      return undefined;
    }

    throw error;
  }
}

describe('persistence', () => {
  let client: DatabaseClient | undefined;
  let testCategoryId: string | undefined;
  let testEventId: string | undefined;
  let testOrderId: string | undefined;
  let testOrderLineId: string | undefined;
  let testPlatformFeeRuleIds: string[] = [];
  let testTicketTypeId: string | undefined;
  let testUserId: string | undefined;

  afterEach(async () => {
    if (client && testOrderLineId) {
      await client.$executeRaw`
        DELETE FROM order_line WHERE id = ${testOrderLineId}
      `;
    }

    if (client && testOrderId) {
      await client.$executeRaw`
        DELETE FROM inventory_hold WHERE "orderId" = ${testOrderId}
      `;
      await client.$executeRaw`
        DELETE FROM "order" WHERE id = ${testOrderId}
      `;
    }

    if (client) {
      for (const ruleId of testPlatformFeeRuleIds) {
        await client.$executeRaw`
          DELETE FROM platform_fee_rule WHERE id = ${ruleId}
        `;
      }
    }

    if (client && testTicketTypeId) {
      await client.$executeRaw`
        DELETE FROM ticket_type WHERE id = ${testTicketTypeId}
      `;
    }

    if (client && testEventId) {
      await client.$executeRaw`
        DELETE FROM event WHERE id = ${testEventId}
      `;
    }

    if (client && testCategoryId) {
      await client.$executeRaw`
        DELETE FROM event_category WHERE id = ${testCategoryId}
      `;
    }

    if (client && testUserId) {
      await client.$executeRaw`
        DELETE FROM auth_user WHERE id = ${testUserId}
      `;
    }

    await client?.$disconnect();
    client = undefined;
    testCategoryId = undefined;
    testEventId = undefined;
    testOrderId = undefined;
    testOrderLineId = undefined;
    testPlatformFeeRuleIds = [];
    testTicketTypeId = undefined;
    testUserId = undefined;
  });

  it('connects to the configured EveryTicket PostgreSQL database', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    const result = await client.$queryRaw<{ database: string }[]>`
      SELECT current_database() AS database
    `;

    expect(result).toEqual([{ database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) }]);
  });

  it('has Better Auth tables isolated under auth_ names', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    const tables = await client.$queryRaw<{ name: string }[]>`
      SELECT tablename AS name
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'auth_account',
          'auth_session',
          'auth_user',
          'auth_verification'
        )
      ORDER BY tablename
    `;

    expect(tables).toEqual([
      { name: 'auth_account' },
      { name: 'auth_session' },
      { name: 'auth_user' },
      { name: 'auth_verification' }
    ]);
  });

  it('allows only one application profile for each Better Auth user', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    testUserId = randomUUID();
    const email = `${testUserId}@example.test`;

    await client.$executeRaw`
      INSERT INTO auth_user (
        id, name, email, "emailVerified", "createdAt", "updatedAt"
      )
      VALUES (
        ${testUserId}, 'Test user', ${email}, false, NOW(), NOW()
      )
    `;

    await client.$executeRaw`
      INSERT INTO application_profile (
        id, "userId", role, status, "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()}, ${testUserId}, 'CUSTOMER', 'ACTIVE', NOW(), NOW()
      )
    `;

    await expect(
      client.$executeRaw`
        INSERT INTO application_profile (
          id, "userId", role, status, "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()}, ${testUserId}, 'CUSTOMER', 'ACTIVE', NOW(), NOW()
        )
      `
    ).rejects.toThrow();
  });

  it('creates an active customer profile when Better Auth registers a user', async () => {
    const createAuth = await loadAuthFactory();
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createAuth || !createDatabaseClient || !databaseUrl) {
      throw new Error('identity dependencies are unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    const auth = createAuth({
      baseUrl: 'http://localhost:3000',
      databaseClient: client,
      databaseUrl,
      secret: 'test-secret-with-at-least-thirty-two-characters'
    });
    const email = `${randomUUID()}@example.test`;
    const registration = await auth.api.signUpEmail({
      body: {
        email,
        name: 'Test customer',
        password: 'password1234'
      }
    });

    testUserId = registration.user.id;
    const profiles = await client.$queryRaw<
      { role: string; status: string }[]
    >`
      SELECT role::text, status::text
      FROM application_profile
      WHERE "userId" = ${testUserId}
    `;

    expect(registration.user.email).toBe(email);
    expect(profiles).toEqual([{ role: 'CUSTOMER', status: 'ACTIVE' }]);
  });

  it('prevents two events from sharing a public slug', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    testUserId = randomUUID();
    const categoryId = randomUUID();
    const eventId = randomUUID();
    const profileId = randomUUID();
    const email = `${testUserId}@example.test`;
    const slug = `test-event-${randomUUID()}`;

    await client.$executeRaw`
      INSERT INTO auth_user (
        id, name, email, "emailVerified", "createdAt", "updatedAt"
      )
      VALUES (${testUserId}, 'Test organizer', ${email}, false, NOW(), NOW())
    `;
    await client.$executeRaw`
      INSERT INTO application_profile (
        id, "userId", role, status, "createdAt", "updatedAt"
      )
      VALUES (
        ${profileId}, ${testUserId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW()
      )
    `;
    await client.$executeRaw`
      INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt")
      VALUES (
        ${categoryId}, 'Music', ${`music-${categoryId}`}, NOW(), NOW()
      )
    `;
    testCategoryId = categoryId;
    await client.$executeRaw`
      INSERT INTO event (
        id, "organizerProfileId", "categoryId", title, slug, description,
        city, state, venue, address, "timeZone", "startAt", "endAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${eventId}, ${profileId}, ${categoryId}, 'Test event', ${slug},
        'Test description', 'Lagos', 'Lagos', 'Test venue', 'Test address',
        'Africa/Lagos', NOW(), NOW() + INTERVAL '1 hour', NOW(), NOW()
      )
    `;
    testEventId = eventId;

    await expect(
      client.$executeRaw`
        INSERT INTO event (
          id, "organizerProfileId", "categoryId", title, slug, description,
          city, state, venue, address, "timeZone", "startAt", "endAt",
          "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()}, ${profileId}, ${categoryId}, 'Duplicate event',
          ${slug}, 'Test description', 'Lagos', 'Lagos', 'Test venue',
          'Test address', 'Africa/Lagos', NOW(), NOW() + INTERVAL '1 hour',
          NOW(), NOW()
        )
      `
    ).rejects.toThrow();
  });

  it('stores ticket types with server-enforced catalog constraints', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    testUserId = randomUUID();
    const categoryId = randomUUID();
    const eventId = randomUUID();
    const profileId = randomUUID();
    const ticketTypeId = randomUUID();

    await client.$executeRaw`
      INSERT INTO auth_user (
        id, name, email, "emailVerified", "createdAt", "updatedAt"
      )
      VALUES (
        ${testUserId}, 'Test organizer', ${`${testUserId}@example.test`},
        false, NOW(), NOW()
      )
    `;
    await client.$executeRaw`
      INSERT INTO application_profile (
        id, "userId", role, status, "createdAt", "updatedAt"
      )
      VALUES (
        ${profileId}, ${testUserId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW()
      )
    `;
    await client.$executeRaw`
      INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt")
      VALUES (
        ${categoryId}, ${`Music ${categoryId}`}, ${`music-${categoryId}`},
        NOW(), NOW()
      )
    `;
    testCategoryId = categoryId;
    await client.$executeRaw`
      INSERT INTO event (
        id, "organizerProfileId", "categoryId", title, slug, description,
        city, state, venue, address, "timeZone", "startAt", "endAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${eventId}, ${profileId}, ${categoryId}, 'Test event',
        ${`test-event-${eventId}`}, 'Test description', 'Lagos', 'Lagos',
        'Test venue', 'Test address', 'Africa/Lagos', NOW(),
        NOW() + INTERVAL '1 hour', NOW(), NOW()
      )
    `;
    testEventId = eventId;
    await client.$executeRaw`
      INSERT INTO ticket_type (
        id, "eventId", name, "priceKobo", capacity, "maxPerOrder",
        "salesStartAt", "salesEndAt", "isActive", "createdAt", "updatedAt"
      )
      VALUES (
        ${ticketTypeId}, ${eventId}, 'General admission', 0, 100, 4,
        NOW(), NOW() + INTERVAL '30 minutes', true, NOW(), NOW()
      )
    `;
    testTicketTypeId = ticketTypeId;

    await expect(
      client.$executeRaw`
        INSERT INTO ticket_type (
          id, "eventId", name, "priceKobo", capacity, "isActive",
          "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()}, ${eventId}, 'General admission', 1000, 10, true,
          NOW(), NOW()
        )
      `,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`
        INSERT INTO ticket_type (
          id, "eventId", name, "priceKobo", capacity, "isActive",
          "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()}, ${eventId}, 'Negative price', -1, 10, true,
          NOW(), NOW()
        )
      `,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`
        INSERT INTO ticket_type (
          id, "eventId", name, "priceKobo", capacity, "isActive",
          "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()}, ${eventId}, 'No capacity', 0, 0, true,
          NOW(), NOW()
        )
      `,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`
        INSERT INTO ticket_type (
          id, "eventId", name, "priceKobo", capacity, "salesStartAt",
          "salesEndAt", "isActive", "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()}, ${eventId}, 'Backwards sale window', 0, 10,
          NOW(), NOW() - INTERVAL '1 minute', true, NOW(), NOW()
        )
      `,
    ).rejects.toThrow();
  });

  it('allows one effective platform-fee rule at a time', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    const firstRuleId = randomUUID();
    const followingRuleId = randomUUID();

    await client.$executeRaw`
      INSERT INTO platform_fee_rule (
        id, version, mode, "percentageBasisPoints", "activeFrom", "activeUntil",
        "appliesToFreeOrder", "createdAt"
      )
      VALUES (
        ${firstRuleId}, 1, 'PERCENTAGE', 250,
        '2027-01-01T00:00:00.000Z', '2027-01-02T00:00:00.000Z', false, NOW()
      )
    `;
    testPlatformFeeRuleIds = [firstRuleId];

    await expect(
      client.$executeRaw`
        INSERT INTO platform_fee_rule (
          id, version, mode, "percentageBasisPoints", "activeFrom", "activeUntil",
          "appliesToFreeOrder", "createdAt"
        )
        VALUES (
          ${randomUUID()}, 2, 'PERCENTAGE', 300,
          '2027-01-01T12:00:00.000Z', '2027-01-03T00:00:00.000Z', false, NOW()
        )
      `,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`
        INSERT INTO platform_fee_rule (
          id, version, mode, "percentageBasisPoints", "fixedAmountKobo",
          "activeFrom", "appliesToFreeOrder", "createdAt"
        )
        VALUES (
          ${randomUUID()}, 3, 'FIXED', 250, 500,
          '2027-01-03T00:00:00.000Z', false, NOW()
        )
      `,
    ).rejects.toThrow();

    await client.$executeRaw`
      INSERT INTO platform_fee_rule (
        id, version, mode, "fixedAmountKobo", "activeFrom",
        "appliesToFreeOrder", "createdAt"
      )
      VALUES (
        ${followingRuleId}, 2, 'FIXED', 500,
        '2027-01-02T00:00:00.000Z', false, NOW()
      )
    `;
    testPlatformFeeRuleIds.push(followingRuleId);
  });

  it('persists an immutable, internally consistent order price snapshot', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    testUserId = randomUUID();
    const categoryId = randomUUID();
    const eventId = randomUUID();
    const profileId = randomUUID();
    const ticketTypeId = randomUUID();
    const feeRuleId = randomUUID();
    const orderId = randomUUID();
    const orderLineId = randomUUID();
    const reference = `ET-${randomUUID()}`;

    await client.$executeRaw`
      INSERT INTO auth_user (
        id, name, email, "emailVerified", "createdAt", "updatedAt"
      )
      VALUES (
        ${testUserId}, 'Test organizer', ${`${testUserId}@example.test`},
        false, NOW(), NOW()
      )
    `;
    await client.$executeRaw`
      INSERT INTO application_profile (
        id, "userId", role, status, "createdAt", "updatedAt"
      )
      VALUES (
        ${profileId}, ${testUserId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW()
      )
    `;
    await client.$executeRaw`
      INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt")
      VALUES (
        ${categoryId}, ${`Music ${categoryId}`}, ${`music-${categoryId}`},
        NOW(), NOW()
      )
    `;
    testCategoryId = categoryId;
    await client.$executeRaw`
      INSERT INTO event (
        id, "organizerProfileId", "categoryId", title, slug, description,
        city, state, venue, address, "timeZone", "startAt", "endAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${eventId}, ${profileId}, ${categoryId}, 'Test event',
        ${`test-event-${eventId}`}, 'Test description', 'Lagos', 'Lagos',
        'Test venue', 'Test address', 'Africa/Lagos', NOW(),
        NOW() + INTERVAL '1 hour', NOW(), NOW()
      )
    `;
    testEventId = eventId;
    await client.$executeRaw`
      INSERT INTO ticket_type (
        id, "eventId", name, "priceKobo", capacity, "isActive",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${ticketTypeId}, ${eventId}, 'General admission', 1500, 100, true,
        NOW(), NOW()
      )
    `;
    testTicketTypeId = ticketTypeId;
    await client.$executeRaw`
      INSERT INTO platform_fee_rule (
        id, version, mode, "percentageBasisPoints", "activeFrom",
        "appliesToFreeOrder", "createdAt"
      )
      VALUES (${feeRuleId}, 1, 'PERCENTAGE', 250, NOW(), false, NOW())
    `;
    testPlatformFeeRuleIds = [feeRuleId];
    await client.$executeRaw`
      INSERT INTO "order" (
        id, reference, "eventId", "customerProfileId", "buyerName", "buyerEmail",
        currency, "ticketSubtotalKobo", "platformFeeKobo", "totalKobo",
        "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode",
        "platformFeePercentageBasisPoints", status, "holdExpiresAt", "createdAt"
      )
      VALUES (
        ${orderId}, ${reference}, ${eventId}, ${profileId}, 'Test buyer',
        'buyer@example.test', 'NGN', 3000, 75, 3075, ${feeRuleId}, 1,
        'PERCENTAGE', 250, 'PENDING_PAYMENT', NOW() + INTERVAL '10 minutes', NOW()
      )
    `;
    testOrderId = orderId;
    await client.$executeRaw`
      INSERT INTO order_line (
        id, "orderId", "ticketTypeId", "ticketTypeName", "unitPriceKobo",
        quantity, "createdAt"
      )
      VALUES (
        ${orderLineId}, ${orderId}, ${ticketTypeId}, 'General admission', 1500,
        2, NOW()
      )
    `;
    testOrderLineId = orderLineId;

    await expect(
      client.$executeRaw`
        INSERT INTO "order" (
          id, reference, "eventId", "buyerName", "buyerEmail", currency,
          "ticketSubtotalKobo", "platformFeeKobo", "totalKobo",
          "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode",
          "platformFeePercentageBasisPoints", status, "holdExpiresAt", "createdAt"
        )
        VALUES (
          ${randomUUID()}, ${`ET-${randomUUID()}`}, ${eventId}, 'Test buyer',
          'buyer@example.test', 'NGN', 3000, 75, 3000, ${feeRuleId}, 1,
          'PERCENTAGE', 250, 'PENDING_PAYMENT', NOW() + INTERVAL '10 minutes', NOW()
        )
      `,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`
        INSERT INTO "order" (
          id, reference, "eventId", "buyerName", "buyerEmail", currency,
          "ticketSubtotalKobo", "platformFeeKobo", "totalKobo",
          "platformFeeRuleId", "platformFeeRuleVersion", "platformFeeMode",
          "platformFeePercentageBasisPoints", status, "holdExpiresAt", "createdAt"
        )
        VALUES (
          ${randomUUID()}, ${reference}, ${eventId}, 'Test buyer',
          'buyer@example.test', 'NGN', 3000, 75, 3075, ${feeRuleId}, 1,
          'PERCENTAGE', 250, 'PENDING_PAYMENT', NOW() + INTERVAL '10 minutes', NOW()
        )
      `,
    ).rejects.toThrow();
  });

  it('stores an expiring positive quantity inventory hold for a pending order', async () => {
    const createDatabaseClient = await loadDatabaseClientFactory();
    const databaseUrl = process.env.DATABASE_URL;

    if (!createDatabaseClient || !databaseUrl) {
      throw new Error('Prisma database client is unavailable');
    }

    client = createDatabaseClient(databaseUrl);
    await client.$connect();

    testUserId = randomUUID();
    const categoryId = randomUUID();
    const eventId = randomUUID();
    const profileId = randomUUID();
    const ticketTypeId = randomUUID();
    const feeRuleId = randomUUID();
    const orderId = randomUUID();
    const holdId = randomUUID();

    await client.$executeRaw`
      INSERT INTO auth_user (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${testUserId}, 'Test organizer', ${`${testUserId}@example.test`}, false, NOW(), NOW())
    `;
    await client.$executeRaw`
      INSERT INTO application_profile (id, "userId", role, status, "createdAt", "updatedAt")
      VALUES (${profileId}, ${testUserId}, 'ORGANIZER', 'ACTIVE', NOW(), NOW())
    `;
    await client.$executeRaw`
      INSERT INTO event_category (id, name, slug, "createdAt", "updatedAt")
      VALUES (${categoryId}, ${`Music ${categoryId}`}, ${`music-${categoryId}`}, NOW(), NOW())
    `;
    testCategoryId = categoryId;
    await client.$executeRaw`
      INSERT INTO event (
        id, "organizerProfileId", "categoryId", title, slug, description,
        city, state, venue, address, "timeZone", "startAt", "endAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${eventId}, ${profileId}, ${categoryId}, 'Test event', ${`test-event-${eventId}`},
        'Test description', 'Lagos', 'Lagos', 'Test venue', 'Test address',
        'Africa/Lagos', NOW(), NOW() + INTERVAL '1 hour', NOW(), NOW()
      )
    `;
    testEventId = eventId;
    await client.$executeRaw`
      INSERT INTO ticket_type (id, "eventId", name, "priceKobo", capacity, "isActive", "createdAt", "updatedAt")
      VALUES (${ticketTypeId}, ${eventId}, 'General admission', 1500, 100, true, NOW(), NOW())
    `;
    testTicketTypeId = ticketTypeId;
    await client.$executeRaw`
      INSERT INTO platform_fee_rule (
        id, version, mode, "fixedAmountKobo", "activeFrom", "appliesToFreeOrder", "createdAt"
      )
      VALUES (${feeRuleId}, 1, 'FIXED', 0, NOW(), false, NOW())
    `;
    testPlatformFeeRuleIds = [feeRuleId];
    await client.$executeRaw`
      INSERT INTO "order" (
        id, reference, "eventId", "buyerName", "buyerEmail", currency,
        "ticketSubtotalKobo", "platformFeeKobo", "totalKobo", "platformFeeRuleId",
        "platformFeeRuleVersion", "platformFeeMode", "platformFeeFixedAmountKobo",
        status, "holdExpiresAt", "createdAt"
      )
      VALUES (
        ${orderId}, ${`ET-${randomUUID()}`}, ${eventId}, 'Test buyer', 'buyer@example.test',
        'NGN', 1500, 0, 1500, ${feeRuleId}, 1, 'FIXED', 0, 'PENDING_PAYMENT',
        NOW() + INTERVAL '10 minutes', NOW()
      )
    `;
    testOrderId = orderId;
    await client.$executeRaw`
      INSERT INTO inventory_hold (id, "orderId", "ticketTypeId", quantity, "expiresAt", "createdAt")
      VALUES (${holdId}, ${orderId}, ${ticketTypeId}, 2, NOW() + INTERVAL '10 minutes', NOW())
    `;

    await expect(
      client.$executeRaw`
        INSERT INTO inventory_hold (id, "orderId", "ticketTypeId", quantity, "expiresAt", "createdAt")
        VALUES (${randomUUID()}, ${orderId}, ${ticketTypeId}, 1, NOW() + INTERVAL '10 minutes', NOW())
      `,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`
        INSERT INTO inventory_hold (id, "orderId", "ticketTypeId", quantity, "expiresAt", "createdAt")
        VALUES (${randomUUID()}, ${orderId}, ${ticketTypeId}, 0, NOW() + INTERVAL '10 minutes', NOW())
      `,
    ).rejects.toThrow();
  });
});
