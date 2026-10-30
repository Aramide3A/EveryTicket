import { ServiceUnavailableException } from '@nestjs/common';
import { createDatabaseClient } from './prisma-client.js';

type Disconnectable = { $disconnect(): Promise<void> };

export async function withDatabase<T, TDatabase extends Disconnectable = ReturnType<typeof createDatabaseClient>>({
  databaseUrl = process.env.DATABASE_URL,
  unavailableMessage,
  createClient = (() => createDatabaseClient(databaseUrl as string)) as unknown as () => TDatabase,
  callback,
}: {
  databaseUrl?: string;
  unavailableMessage: string;
  createClient?: () => TDatabase;
  callback: (database: TDatabase) => Promise<T>;
}): Promise<T> {
  if (!databaseUrl) throw new ServiceUnavailableException(unavailableMessage);
  const database = createClient();
  try {
    return await callback(database);
  } finally {
    await database.$disconnect();
  }
}

export function createDatabaseOperation(unavailableMessage: string) {
  return <T>(callback: (database: ReturnType<typeof createDatabaseClient>) => Promise<T>) => withDatabase({ unavailableMessage, callback });
}
