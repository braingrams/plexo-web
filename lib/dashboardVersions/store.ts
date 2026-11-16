import { DashboardVersion } from "@/lib/db/coreEntities";
import { clearSnapshot, getSnapshot, setSnapshot } from "./snapshot";
import type { DashboardVersionRow } from "./types";

/**
 * The registry, cached in memory for a minute per server instance so the dashboard layout
 * never hits the table twice per request. An admin's change shows up within ~60s (and at once
 * on the instance that wrote it, via invalidateRegistry). A failed read keeps the last good
 * copy, and an empty registry means "not set up yet" (legacy flag applies).
 */
export const REGISTRY_TTL_MS = 60_000;

let inflight: Promise<DashboardVersionRow[]> | null = null;

export function invalidateRegistry(): void {
  clearSnapshot();
}

export async function loadRegistry(now: number = Date.now()): Promise<DashboardVersionRow[]> {
  const cached = getSnapshot();
  if (cached && now - cached.at < REGISTRY_TTL_MS) return cached.rows;
  if (!inflight) {
    inflight = DashboardVersion.query
      .primary({})
      .go({ pages: "all" })
      .then(({ data }) => {
        const rows = data as DashboardVersionRow[];
        setSnapshot(rows);
        return rows;
      })
      .catch((err) => {
        console.error("dashboard version registry:", err);
        return getSnapshot()?.rows ?? [];
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
