/** Visits per day for the last `days` days, oldest first, in the viewer-agnostic UTC day. Pure. */
const DAY = 86_400_000;

export function bucketVisitsByDay(timestamps: (string | null | undefined)[], now: number = Date.now(), days = 7): number[] {
  const out = new Array<number>(days).fill(0);
  const todayStart = Math.floor(now / DAY) * DAY;
  for (const ts of timestamps) {
    const t = ts ? Date.parse(ts) : NaN;
    if (!Number.isFinite(t)) continue;
    const back = Math.floor((todayStart - Math.floor(t / DAY) * DAY) / DAY);
    if (back < 0 || back >= days) continue;
    out[days - 1 - back] += 1;
  }
  return out;
}

/** Short weekday labels (Mon, Tue...) matching bucketVisitsByDay's order. */
export function dayLabels(now: number = Date.now(), days = 7): string[] {
  const todayStart = Math.floor(now / DAY) * DAY;
  return Array.from({ length: days }, (_, i) => new Date(todayStart - (days - 1 - i) * DAY).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }));
}
