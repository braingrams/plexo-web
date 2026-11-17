/**
 * The Domains page's pure logic: how an address is described (status), how a long list is
 * narrowed and grouped, and the plain-words "what will change" before moving an address to
 * another site. No React, no network.
 */
import type { AddressRow } from "./domainsData";

export type AddressStatus = "online" | "setting-up" | "attention";
export type KindFilter = "all" | "own" | "free";
export type AddressFilters = { q: string; siteId: string; kind: KindFilter; status: AddressStatus | "all" };

export const NO_FILTERS: AddressFilters = { q: "", siteId: "all", kind: "all", status: "all" };

/** Online = visitors can reach it; Setting up = a connected address still waiting on the steps; Needs attention = switched off. */
export function addressStatus(r: Pick<AddressRow, "type" | "online" | "pausedByPlan">): AddressStatus {
  if (r.pausedByPlan) return "attention";
  if (r.online) return "online";
  return r.type === "CUSTOM" ? "setting-up" : "attention";
}

export const STATUS_LABEL: Record<AddressStatus, string> = { online: "Online", "setting-up": "Setting up", attention: "Needs attention" };

export function addressCounts(rows: AddressRow[]) {
  const c = { total: rows.length, online: 0, "setting-up": 0, attention: 0, own: 0, free: 0 };
  for (const r of rows) {
    c[addressStatus(r)] += 1;
    if (r.type === "CUSTOM") c.own += 1;
    else c.free += 1;
  }
  return c;
}

export function filtersActive(f: AddressFilters): boolean {
  return !!f.q.trim() || f.siteId !== "all" || f.kind !== "all" || f.status !== "all";
}

/** Search matches the address or the site name, ignoring case and a leading "www.". */
export function filterAddresses(rows: AddressRow[], f: AddressFilters): AddressRow[] {
  const q = f.q.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  return rows.filter((r) => {
    if (f.siteId !== "all" && r.siteId !== f.siteId) return false;
    if (f.kind === "own" && r.type !== "CUSTOM") return false;
    if (f.kind === "free" && r.type !== "SUBDOMAIN") return false;
    if (f.status !== "all" && addressStatus(r) !== f.status) return false;
    if (q && !r.domain.toLowerCase().replace(/^www\./, "").includes(q) && !r.siteName.toLowerCase().includes(q)) return false;
    return true;
  });
}

export type AddressGroup = { siteId: string; siteName: string; rows: AddressRow[] };

/** One group per site (sites with the most addresses needing a look first, then by name); own addresses before free ones inside. */
export function groupBySite(rows: AddressRow[]): AddressGroup[] {
  const map = new Map<string, AddressGroup>();
  for (const r of rows) {
    const g = map.get(r.siteId) ?? { siteId: r.siteId, siteName: r.siteName, rows: [] };
    g.rows.push(r);
    map.set(r.siteId, g);
  }
  const need = (g: AddressGroup) => g.rows.filter((r) => addressStatus(r) !== "online").length;
  return [...map.values()]
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => (a.type === b.type ? a.domain.localeCompare(b.domain) : a.type === "CUSTOM" ? -1 : 1)) }))
    .sort((a, b) => need(b) - need(a) || a.siteName.localeCompare(b.siteName));
}

export type SwitchPlan = {
  /** Why this address can't be moved here, or null. */
  blocked: string | null;
  /** Plain sentences telling the owner what will change, in order. */
  lines: string[];
};

/** What moving `row` onto `target` will do, in plain words. The server still applies its own plan limits. */
export function switchPlan(row: AddressRow, target: { id: string; name: string } | undefined, all: AddressRow[]): SwitchPlan {
  if (!target) return { blocked: "Pick the site this address should show.", lines: [] };
  if (target.id === row.siteId) return { blocked: `${row.domain} already shows ${target.name}.`, lines: [] };
  if (row.bought) {
    return { blocked: `${row.domain} was bought through Plexo, so it stays with ${row.siteName} for now. Ask us in chat and we'll move it for you.`, lines: [] };
  }
  const left = all.filter((a) => a.siteId === row.siteId && a.id !== row.id);
  const lines = [`${row.domain} will show ${target.name} instead of ${row.siteName}.`];
  if (left.some((a) => a.type === "SUBDOMAIN")) lines.push(`${row.siteName} keeps its free address.`);
  else if (left.length) lines.push(`${row.siteName} keeps its other ${left.length === 1 ? "address" : "addresses"}.`);
  else lines.push(`${row.siteName} will have no web address until you add one.`);
  lines.push(row.type === "CUSTOM" ? "Nothing changes at the company where you bought it. Visitors see the new site straight away." : "Anyone who opens this link will see the new site straight away.");
  lines.push("Nothing is deleted. You can switch it back any time.");
  return { blocked: null, lines };
}

/** The address name sent when relinking: a free address is sent as just its first part. */
export function relinkDomainValue(row: Pick<AddressRow, "type" | "domain">): string {
  return row.type === "SUBDOMAIN" ? row.domain.split(".")[0] : row.domain;
}
