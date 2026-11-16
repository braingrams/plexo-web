import { RateLimit } from "@/lib/db/opsEntities";

// Calendar-day key — resets at UTC midnight automatically because a new date = a new key.
// 48-hour TTL on the DynamoDB item means old keys self-delete without a cron.
function dailyKey(templateId: string): string {
  return `DAPP:${templateId}:${new Date().toISOString().slice(0, 10)}`;
}

function ttlInSeconds(): number {
  return Math.floor(Date.now() / 1000) + 48 * 3600;
}

/**
 * Increments the daily Lambda-invocation counter for a deployed app and returns whether
 * the request is within the owner's plan limit. Returns true (allowed) when `limit` is
 * null (Pro and above — no cap). Non-linearizable under extreme concurrency (see
 * checkCommerceRateLimit's own comment) — acceptable here because a soft cost-protection
 * cap does not need database-enforced atomicity.
 */
export async function checkDeployedAppDailyLimit(
  templateId: string,
  limit: number | null,
): Promise<boolean> {
  if (limit === null) return true;

  const key = dailyKey(templateId);
  const now = Date.now();
  const { data: existing } = await RateLimit.get({ key }).go();

  if (!existing) {
    try {
      await RateLimit.create({ key, count: 1, lastRequest: now, ttl: ttlInSeconds() }).go();
    } catch {
      // Lost the create race — another concurrent first request of the day won.
      // Fall through and increment the row it just wrote.
      await RateLimit.patch({ key }).add({ count: 1 }).go();
    }
    return true;
  }

  if (existing.count >= limit) return false;
  await RateLimit.patch({ key }).add({ count: 1 }).go();
  return true;
}
