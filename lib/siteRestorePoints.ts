/**
 * "Your site, day by day": every day the owner published something, and putting the whole site back the way it was at the end of
 * one of those days. Pure planning lives here (tested); the database reads and writes are in the restore-points route.
 */
export type SiteRevision = { pageId: string; pageName: string; id: string; createdAt: string };
export type RestoreDay = { day: string; publishes: number; pages: number; lastAt: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** The owner's calendar day for a moment. `tzOffsetMinutes` is what the browser's getTimezoneOffset() gives (minutes behind UTC). */
export function localDay(iso: string, tzOffsetMinutes: number): string {
  const d = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The last instant of an owner's calendar day, as an ISO time. */
export function endOfLocalDay(day: string, tzOffsetMinutes: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) + tzOffsetMinutes * 60_000).toISOString();
}

export function groupRestoreDays(revs: SiteRevision[], tzOffsetMinutes: number): RestoreDay[] {
  const by = new Map<string, { publishes: number; pages: Set<string>; lastAt: string }>();
  for (const r of revs) {
    const day = localDay(r.createdAt, tzOffsetMinutes);
    const cur = by.get(day) ?? { publishes: 0, pages: new Set<string>(), lastAt: r.createdAt };
    cur.publishes++;
    cur.pages.add(r.pageId);
    if (r.createdAt > cur.lastAt) cur.lastAt = r.createdAt;
    by.set(day, cur);
  }
  return [...by.entries()].map(([day, v]) => ({ day, publishes: v.publishes, pages: v.pages.size, lastAt: v.lastAt })).sort((a, b) => b.day.localeCompare(a.day));
}

export type RestorePlan = {
  /** Page → the version it goes back to. */
  restore: Array<{ pageId: string; pageName: string; revisionId: string }>;
  /** Pages that didn't exist yet on that day: left exactly as they are. */
  untouched: string[];
};

/** For each page, its newest version published on or before the cutoff. */
export function planSiteRestore(revs: SiteRevision[], allPages: Array<{ id: string; name: string }>, cutoffIso: string, activeIds: Map<string, string | null | undefined>): RestorePlan {
  const restore: RestorePlan["restore"] = [];
  const untouched: string[] = [];
  for (const p of allPages) {
    const mine = revs.filter((r) => r.pageId === p.id && r.createdAt <= cutoffIso).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!mine.length) { untouched.push(p.name); continue; }
    if (activeIds.get(p.id) === mine[0].id) continue; // already exactly that version
    restore.push({ pageId: p.id, pageName: p.name, revisionId: mine[0].id });
  }
  return { restore, untouched };
}
