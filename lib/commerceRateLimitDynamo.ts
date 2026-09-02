import { RateLimit } from "@/lib/db/opsEntities";

const DEFAULT_WINDOW_MS = 5 * 60_000;

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Fixed-window rate limiter for Commerce's unauthenticated public endpoints, backed by
 * the shared RateLimit entity (lib/db/opsEntities.ts) — a 1-hour TTL self-cleans stale
 * counters instead of needing a cron. Not linearizable under extreme concurrency: two
 * requests landing in the exact same instant on a brand-new key could both see "no row
 * yet" and both try to create one (one loses the race, handled below by falling through
 * to an increment). That's an acceptable trade-off here — this guards against abusive
 * traffic bursts, not something that needs the DB-enforced atomicity stock/booking
 * require (where the failure mode is an actual oversold unit or double-booked slot, not
 * a slightly generous rate-limit window).
 */
export async function checkCommerceRateLimit(key: string, limit: number, windowMs: number = DEFAULT_WINDOW_MS): Promise<boolean> {
  const now = Date.now();
  const { data: existing } = await RateLimit.get({ key }).go();

  if (!existing || now - existing.lastRequest > windowMs) {
    try {
      await RateLimit.create({ key, count: 1, lastRequest: now }).go();
      return true;
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err;
      // Lost the create race — another concurrent first-request-in-window beat us to it.
      // Fall through to the increment path against whatever it just wrote.
    }
  } else if (existing.count >= limit) {
    return false;
  } else {
    await RateLimit.patch({ key }).set({ count: existing.count + 1 }).go();
    return true;
  }

  await RateLimit.patch({ key }).add({ count: 1 }).go();
  return true;
}

/** Best-effort client IP from standard proxy headers — good enough for abuse-rate-limiting,
 * not meant to be spoof-proof (a determined abuser can rotate IPs regardless). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
