type DatabaseOperation = {
  withDatabase<T>(input: {
    databaseUrl?: string;
    unavailableMessage: string;
    createClient: () => { $disconnect(): Promise<void> };
    callback: (database: { $disconnect(): Promise<void> }) => Promise<T>;
  }): Promise<T>;
  createDatabaseOperation(unavailableMessage: string): <T>(callback: (database: { $disconnect(): Promise<void> }) => Promise<T>) => Promise<T>;
};

async function loadDatabaseOperation(): Promise<DatabaseOperation | undefined> {
  try {
    return await import('../src/persistence/database-operation.js') as DatabaseOperation;
  } catch {
    return undefined;
  }
}

describe('database operation boundary', () => {
  it('disconnects the request client after a successful operation', async () => {
    const boundary = await loadDatabaseOperation();
    expect(boundary).toBeDefined();
    if (!boundary) throw new Error('database operation boundary is unavailable');
    let disconnected = false;
    const database = { $disconnect: async () => { disconnected = true; } };

    await expect(boundary.withDatabase({ databaseUrl: 'postgresql://database.example.test', unavailableMessage: 'unavailable', createClient: () => database, callback: async () => 'result' })).resolves.toBe('result');
    expect(disconnected).toBe(true);
  });

  it('creates a reusable feature operation with its unavailable message', async () => {
    const boundary = await loadDatabaseOperation();
    expect(boundary).toBeDefined();
    if (!boundary) throw new Error('database operation boundary is unavailable');
    const operation = boundary.createDatabaseOperation('feature is unavailable');
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(operation(async () => 'result')).rejects.toMatchObject({ message: 'feature is unavailable' });
    } finally {
      if (databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = databaseUrl;
    }
  });
});
