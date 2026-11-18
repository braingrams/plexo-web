/** The site switcher's list: search, "Recent" then "All sites", and a line that tells look-alikes apart. Pure. */
import type { SiteSummary } from "./sites";

export const RECENT_COUNT = 5;

const DAY = 86_400_000;

/** "Edited today", "Edited 3 days ago", "Edited 2 months ago". */
export function editedAgo(updatedAt: string | null | undefined, now: number = Date.now()): string {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(t)) return "Not edited yet";
  const days = Math.max(0, Math.floor((now - t) / DAY));
  if (days === 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 30) return `Edited ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Edited ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `Edited ${years} year${years === 1 ? "" : "s"} ago`;
}

const bare = (address: string) => address.replace(/^https?:\/\//, "").replace(/\/$/, "");

export type SwitchRow = { site: SiteSummary; detail: string };
export type SwitchGroups = { recent: SwitchRow[]; all: SwitchRow[]; searching: boolean; flat: SwitchRow[] };

/**
 * Rows for the panel. The detail line is the web address when there is one, else when it was last
 * edited; sites that would still look identical (same name, kind and line) get a short reference
 * so no two rows are the same.
 */
export function switchGroups(sites: SiteSummary[], query: string, now: number = Date.now()): SwitchGroups {
  const q = query.trim().toLowerCase();
  const base = sites.map((site) => ({ site, detail: site.address ? bare(site.address) : editedAgo(site.updatedAt, now) }));
  const seen = new Map<string, number>();
  for (const r of base) {
    const k = `${r.site.name}|${r.site.kind}|${r.detail}`.toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const rows = base.map((r) => (seen.get(`${r.site.name}|${r.site.kind}|${r.detail}`.toLowerCase())! > 1 ? { ...r, detail: `${r.detail} · ref ${r.site.id.slice(-4)}` } : r));
  const matches = q ? rows.filter((r) => `${r.site.name} ${r.site.kind} ${r.detail}`.toLowerCase().includes(q)) : rows;
  const byName = (a: SwitchRow, b: SwitchRow) => a.site.name.localeCompare(b.site.name, undefined, { sensitivity: "base" });
  if (q) {
    const flat = [...matches].sort(byName);
    return { recent: [], all: flat, searching: true, flat };
  }
  const recent = [...rows].sort((a, b) => (b.site.updatedAt ?? "").localeCompare(a.site.updatedAt ?? "")).slice(0, RECENT_COUNT);
  // Few sites: one list is enough, no "Recent" section.
  if (rows.length <= RECENT_COUNT + 1) {
    const all = [...rows].sort(byName);
    return { recent: [], all, searching: false, flat: all };
  }
  const all = [...rows].sort(byName);
  return { recent, all, searching: false, flat: [...recent, ...all] };
}
