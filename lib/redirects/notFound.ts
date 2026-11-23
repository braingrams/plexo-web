import { NotFoundHit } from "@/lib/db/opsEntities";
import { worthRecording } from "./worth";

const recent = new Map<string, number>();
const WINDOW_MS = 10 * 60 * 1000;
/**
 * Counts one visit to an address that doesn't exist, without ever slowing or breaking the page. Each running copy of the
 * server writes at most once per address every ten minutes, so a bot hammering one address is a single write, and rows
 * expire by themselves 30 days after the last visit.
 */
export function recordNotFound(templateId: string, rawPath: string, referrer?: string | null): void {
  const path = rawPath.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (!worthRecording(path)) return;
  const key = `${templateId}${path}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < WINDOW_MS) return;
  if (recent.size > 2000) recent.clear();
  recent.set(key, now);
  const ref = referrer && referrer.length < 300 ? referrer : undefined;
  void NotFoundHit.update({ templateId, path })
    .add({ count: 1 })
    .set({ lastSeen: new Date().toISOString(), ttl: Math.floor(now / 1000) + 30 * 86400, ...(ref ? { referrer: ref } : {}) })
    .go()
    .catch(() => undefined);
}
