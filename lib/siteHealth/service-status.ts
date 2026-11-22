import type { HealthReport, HealthStatus } from "./types";

/** The weekly turn. */
export const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

/** What the owner is told about automatic checks: when one last ran by itself, and when the next is due. */
export function autoStatus(rows: { createdAt: string; report?: unknown }[], queued: { dueAt: string; reason: "changed" | "weekly" } | null | undefined): NonNullable<HealthStatus["auto"]> {
  const lastAuto = rows.find((r) => (r.report as HealthReport | undefined)?.auto);
  const latest = rows[0];
  if (queued) return { lastAt: lastAuto?.createdAt ?? null, nextAt: queued.dueAt, reason: queued.reason };
  if (latest) return { lastAt: lastAuto?.createdAt ?? null, nextAt: new Date(new Date(latest.createdAt).getTime() + WEEKLY_MS).toISOString(), reason: "weekly" };
  return { lastAt: null, nextAt: null, reason: null };
}
