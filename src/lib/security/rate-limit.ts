/**
 * Rate limit em memória (token bucket por chave).
 * Limitação conhecida: em serverless cada instância tem seu próprio balde, então é uma
 * proteção de melhor esforço. Para produção com volume, trocar por Upstash/Redis ou
 * por um limite no próprio Postgres.
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createRateLimiter(opts: { capacity: number; refillPerSecond: number; maxKeys?: number }) {
  const buckets = new Map<string, Bucket>();
  const maxKeys = opts.maxKeys ?? 10_000;

  return function allow(key: string, now = Date.now()): boolean {
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
      b = { tokens: opts.capacity, updatedAt: now };
      buckets.set(key, b);
    }
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(opts.capacity, b.tokens + elapsed * opts.refillPerSecond);
    b.updatedAt = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}
