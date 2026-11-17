import { describe, expect, it } from "vitest";
import { homeEntry, homeMode } from "@/lib/dashboardV3/homeMode";
import { liveHref, previewHref } from "@/lib/dashboardV3/siteLinks";
import type { SiteSummary } from "@/lib/dashboardV3/sites";

const site = (id: string, updatedAt: string, extra: Partial<SiteSummary> = {}): SiteSummary => ({ id, name: id, kind: "Website", status: "draft", updatedAt, ...extra });
const many = [site("aaaaaa", "2026-01-01"), site("bbbbbb", "2026-03-01"), site("cccccc", "2026-02-01")];

describe("homeEntry (current site)", () => {
  it("has no site and nothing to fix when there are none", () => {
    expect(homeEntry([], "aaaaaa")).toEqual({ current: null, fixCookieTo: null });
  });
  it("uses the one site and sets the cookie when it is missing", () => {
    const r = homeEntry([many[0]], undefined);
    expect(r.current?.id).toBe("aaaaaa");
    expect(r.fixCookieTo).toBe("aaaaaa");
  });
  it("keeps a valid cookie untouched", () => {
    const r = homeEntry(many, "cccccc");
    expect(r.current?.id).toBe("cccccc");
    expect(r.fixCookieTo).toBeNull();
  });
  it("falls back to the most recently edited site when the cookie points at a deleted site", () => {
    const r = homeEntry(many, "deleted-id");
    expect(r.current?.id).toBe("bbbbbb");
    expect(r.fixCookieTo).toBe("bbbbbb");
  });
  it("falls back when the cookie is missing, with many sites", () => {
    expect(homeEntry(many, null).current?.id).toBe("bbbbbb");
  });
});

describe("homeMode", () => {
  it("is 'none' only when there are no sites, whatever the experience", () => {
    for (const experience of ["beginner", "intermediate", "pro"] as const) {
      expect(homeMode({ siteCount: 0, experience, currentAllDone: false })).toBe("none");
    }
  });
  it("one site: beginner and pro", () => {
    expect(homeMode({ siteCount: 1, experience: "beginner", currentAllDone: false })).toBe("site");
    expect(homeMode({ siteCount: 1, experience: "beginner", currentAllDone: true })).toBe("site");
    expect(homeMode({ siteCount: 1, experience: "pro", currentAllDone: false })).toBe("all");
  });
  it("many sites + pro shows the dense Home, even before the current site is online", () => {
    expect(homeMode({ siteCount: 12, experience: "pro", currentAllDone: false })).toBe("all");
  });
  it("intermediate sees everything once the current site is online", () => {
    expect(homeMode({ siteCount: 3, experience: "intermediate", currentAllDone: false })).toBe("site");
    expect(homeMode({ siteCount: 3, experience: "intermediate", currentAllDone: true })).toBe("all");
  });
  it("skipped onboarding never produces the empty screen for someone with sites (it is not an input)", () => {
    const entry = homeEntry(many, undefined);
    expect(entry.current).not.toBeNull();
    expect(homeMode({ siteCount: many.length, experience: "pro", currentAllDone: false })).not.toBe("none");
  });
});

describe("preview and live links", () => {
  it("preview is always the private working copy", () => {
    expect(previewHref("abc123")).toBe("/api/v1/templates/abc123/draft-preview");
  });
  it("live link is the real address, only when online", () => {
    expect(liveHref({ status: "live", address: "shop.example.com" })).toBe("https://shop.example.com");
    expect(liveHref({ status: "live", address: "https://shop.example.com/" })).toBe("https://shop.example.com");
    expect(liveHref({ status: "draft", address: "shop.example.com" })).toBeNull();
    expect(liveHref({ status: "live", address: null })).toBeNull();
    expect(liveHref({ address: "  " })).toBeNull();
  });
});

import { bucketVisitsByDay, dayLabels } from "@/lib/dashboardV3/visitsTrend";

describe("visits trend", () => {
  const now = Date.parse("2026-11-17T15:00:00Z");
  it("buckets visits per day, oldest first, ignoring older and invalid ones", () => {
    const r = bucketVisitsByDay(["2026-11-17T01:00:00Z", "2026-11-17T09:00:00Z", "2026-11-16T23:00:00Z", "2026-11-11T12:00:00Z", "2026-11-10T12:00:00Z", "nope", null], now);
    expect(r).toEqual([1, 0, 0, 0, 0, 1, 2]);
  });
  it("labels the same seven days", () => {
    expect(dayLabels(now)).toEqual(["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"]);
  });
});
