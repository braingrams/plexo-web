import { prisma } from "@/server/prisma";

const DEFAULT_WINDOW_MS = 5 * 60_000;

/**
 * Fixed-window rate limiter for Commerce's unauthenticated public endpoints, backed by the
 * shared RateLimit table (used internally by better-auth elsewhere — reused here rather
 * than adding a new table, scoped by a distinct key prefix so the two never collide).
 *
 * Not linearizable under extreme concurrency: RateLimit.key has no unique constraint (it's
 * shared with better-auth's own usage, which this deliberately doesn't touch), so two
 * requests landing in the exact same instant could each see "no row yet" and both create
 * one. That's an acceptable trade-off here — this guards against abusive traffic bursts,
 * not something that needs the DB-enforced atomicity stock/booking require (where the
 * failure mode is an actual oversold unit or double-booked slot, not a slightly generous
 * rate-limit window).
 */
export async function checkCommerceRateLimit(key: string, limit: number, windowMs: number = DEFAULT_WINDOW_MS): Promise<boolean> {
  const now = Date.now();
  const existing = await prisma.rateLimit.findFirst({ where: { key }, orderBy: { lastRequest: "desc" } });

  if (!existing || now - Number(existing.lastRequest) > windowMs) {
    await prisma.rateLimit.create({ data: { key, count: 1, lastRequest: BigInt(now) } });
    return true;
  }

  if (existing.count >= limit) {
    return false;
  }

  await prisma.rateLimit.update({ where: { id: existing.id }, data: { count: { increment: 1 } } });
  return true;
}

/** Best-effort client IP from standard proxy headers — good enough for abuse-rate-limiting,
 * not meant to be spoof-proof (a determined abuser can rotate IPs regardless). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
