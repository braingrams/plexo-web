import { ExperienceDailyStat } from "@/lib/db/opsEntities";
import type { Experience } from "@/lib/dashboardV3/nav";

/** The two screens people can be on: the simple editor (beginner) or the full one (everyone else). */
export type ExperienceMode = "simple" | "full";

export const modeOf = (experience: Experience): ExperienceMode => (experience === "beginner" ? "simple" : "full");

export type ExperienceEvent = { type: "open" | "publish"; mode: ExperienceMode; userId: string } | { type: "switch"; from: ExperienceMode; to: ExperienceMode };

/**
 * Counts how the simple and full views are used (read by the admin's Experience page). Atomic counters per day, never
 * throws and never blocks the caller: a lost count undercounts a chart by one, which is not worth failing a request over.
 * `.update().add()` is the upsert (see lib/analyticsRollup.ts for why not `.patch()`).
 */
export async function recordExperienceEvent(event: ExperienceEvent, at: Date = new Date()): Promise<void> {
  const date = at.toISOString().slice(0, 10);
  const dimensions =
    event.type === "switch"
      ? [`SWITCH#${event.from}>${event.to}`]
      : [event.type === "open" ? `OPEN#${event.mode}` : `PUBLISH#${event.mode}`, ...(event.type === "open" ? [`ACTIVE#${event.mode}#${event.userId}`] : [])];
  try {
    await Promise.all(dimensions.map((dimension) => ExperienceDailyStat.update({ date, dimension }).add({ count: 1 }).go()));
  } catch (err) {
    console.warn("[experience-stats] could not record", event.type, err instanceof Error ? err.message : err);
  }
}
