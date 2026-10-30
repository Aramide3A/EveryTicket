type RateLimitEntry = { count: number; resetAt: number };

export function createRequestRateLimiter(now: () => number = Date.now) {
  const entries = new Map<string, RateLimitEntry>();

  return {
    consume({ action, identity, limit, windowMs }: { action: string; identity: string; limit: number; windowMs: number }): { allowed: boolean; retryAfterSeconds: number } {
      const timestamp = now();
      const key = `${action}:${identity}`;
      const existing = entries.get(key);
      const entry = !existing || existing.resetAt <= timestamp
        ? { count: 0, resetAt: timestamp + windowMs }
        : existing;
      entry.count += 1;
      entries.set(key, entry);
      return {
        allowed: entry.count <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1_000)),
      };
    },
  };
}

export function readRequestRateLimit(environment: NodeJS.ProcessEnv): { limit: number; windowMs: number } {
  return {
    limit: positiveInteger(environment.RATE_LIMIT_MAX_REQUESTS, 'RATE_LIMIT_MAX_REQUESTS', 30),
    windowMs: positiveInteger(environment.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 60_000),
  };
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
  return result;
}
