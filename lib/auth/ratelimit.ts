// Simple in-memory rate limiter (fixed window per key). One Render instance
// runs Mandi, so process memory is enough; a multi-instance deploy would move
// this to Postgres or Redis.
const g = globalThis as unknown as { mandiLimits?: Map<string, { count: number; resetAt: number }> };
const buckets = (g.mandiLimits ??= new Map());

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** True if this hit is allowed. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export const MINUTE = 60 * 1000;
