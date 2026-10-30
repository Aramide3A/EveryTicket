export async function checkReadiness({
  databaseCheck,
  redisCheck,
}: {
  databaseCheck(): Promise<void>;
  redisCheck(): Promise<void>;
}): Promise<{ status: 'ok' | 'error'; checks: { database: 'ok' | 'error'; redis: 'ok' | 'error' } }> {
  const [database, redis] = await Promise.allSettled([databaseCheck(), redisCheck()]);
  const checks = { database: database.status === 'fulfilled' ? 'ok' as const : 'error' as const, redis: redis.status === 'fulfilled' ? 'ok' as const : 'error' as const };
  return { status: checks.database === 'ok' && checks.redis === 'ok' ? 'ok' : 'error', checks };
}
