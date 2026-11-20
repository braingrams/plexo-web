/** When a Plexo-managed property is kept and when it is cleaned up after a plan ends (see lifecycle.ts). */
export const LAPSE_RETENTION_DAYS = 90;

export type LapseStep = "none" | "clear_mark" | "set_mark" | "delete";

/** Pure: what to do with one managed row. */
export function lapseStep(row: { lapsedAt?: string | null }, entitled: boolean, now: Date): LapseStep {
  if (entitled) return row.lapsedAt ? "clear_mark" : "none";
  if (!row.lapsedAt) return "set_mark";
  const days = (now.getTime() - Date.parse(row.lapsedAt)) / 86_400_000;
  return Number.isFinite(days) && days >= LAPSE_RETENTION_DAYS ? "delete" : "none";
}

