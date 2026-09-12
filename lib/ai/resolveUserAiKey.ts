import { ApiKey } from "@/lib/db/coreEntities";
import type { EntityItem } from "electrodb";

export type ActiveApiKey = EntityItem<typeof ApiKey>;

/**
 * The one shared "which of this user's own API keys governs their in-app AI features"
 * heuristic: the most recently created still-active key for that user. `ApiKey` has no
 * `isDefault`/`isPrimary` flag (confirmed against lib/db/coreEntities.ts) and no naming
 * convention for one — "most recent active" is a convention enforced only in application
 * code, first established in app/api/v1/ai/generate/route.ts's `resolveAiKey` and
 * independently duplicated in app/dashboard/templates/[id]/page.tsx. Extracted here so SOL's
 * agent loop (lib/ai/solChatHandler.ts) can reuse the exact same rule instead of adding a
 * third copy.
 */
export async function resolveActiveApiKeyForUser(userId: string): Promise<ActiveApiKey | null> {
  const { data: keys } = await ApiKey.query.byUser({ userId }).go();
  const active = keys.filter((k) => k.isActive).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return active[0] ?? null;
}
