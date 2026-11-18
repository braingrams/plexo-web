import { describe, expect, it } from "vitest";
import { editedAgo, switchGroups } from "@/lib/dashboardV3/siteSwitch";
import type { SiteSummary } from "@/lib/dashboardV3/sites";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const sites: SiteSummary[] = Array.from({ length: 30 }, (_, i) => ({
  id: `site-${String(i).padStart(4, "0")}`,
  name: i % 3 === 0 ? "Home" : i % 7 === 0 ? "Haven Realty: premium" : i === 5 ? "Software Engineering 101: an extremely long course name that never fits in a sidebar at all" : `Site ${i}`,
  kind: i % 4 === 0 ? "Online store" : "Website",
  status: i % 2 ? "live" : "draft",
  address: i % 5 === 0 ? `s${i}.plexopages.com` : null,
  updatedAt: day(i),
}));

describe("site switcher list", () => {
  it("says when a site was last edited in plain words", () => {
    expect(editedAgo(day(0), NOW)).toBe("Edited today");
    expect(editedAgo(day(3), NOW)).toBe("Edited 3 days ago");
    expect(editedAgo(day(65), NOW)).toBe("Edited 2 months ago");
    expect(editedAgo(null, NOW)).toBe("Not edited yet");
  });
  it("shows the 5 most recent, then every site alphabetically", () => {
    const g = switchGroups(sites, "", NOW);
    expect(g.recent.map((r) => r.site.id)).toEqual(sites.slice(0, 5).map((s) => s.id));
    expect(g.all).toHaveLength(30);
    const names = g.all.map((r) => r.site.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  });
  it("uses the web address, else the edit time, and never shows two identical rows", () => {
    const g = switchGroups(sites, "", NOW);
    const seen = new Set(g.all.map((r) => `${r.site.name}|${r.site.kind}|${r.detail}`));
    expect(seen.size).toBe(30);
    expect(g.all.find((r) => r.site.id === "site-0010")!.detail).toMatch(/plexopages/);
  });
  it("searches names, kinds and addresses in one list", () => {
    expect(switchGroups(sites, "software engineering", NOW).flat).toHaveLength(1);
    expect(switchGroups(sites, "plexopages", NOW).flat.length).toBeGreaterThan(3);
    expect(switchGroups(sites, "zzzz", NOW).flat).toHaveLength(0);
  });
  it("keeps one plain list when there are only a few sites", () => {
    const g = switchGroups(sites.slice(0, 4), "", NOW);
    expect(g.recent).toHaveLength(0);
    expect(g.all).toHaveLength(4);
  });
});
