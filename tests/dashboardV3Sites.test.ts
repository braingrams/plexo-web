import { describe, expect, it } from "vitest";
import { isRealSite, summarizeSites, type TemplateRow } from "@/lib/dashboardV3/siteList";

const T = (id: string, extra: Partial<TemplateRow> = {}): TemplateRow => ({ id, name: id, kind: "LANDING_PAGE", updatedAt: `2026-0${(id.length % 9) + 1}-01`, ...extra });

const real: TemplateRow[] = [
  T("builder", { sourceType: "BUILDER" }),
  T("raw", { sourceType: "RAW_UPLOAD" }),
  T("wp", { name: "Muzingo | Online Music Bingo Game", sourceType: "RAW_UPLOAD", migratedFrom: "https://muzingo.com" }),
  T("app", { sourceType: "REACT_PROJECT" }),
  T("funnel", { isLmsFunnel: true }),
  T("legacy-no-kind", { kind: null }),
];
const notSites: TemplateRow[] = [
  T("email", { kind: "EMAIL" }),
  T("child", { parentId: "builder" }),
  T("fragment", { isSiteLayoutFragment: true }),
  T("blog-layout", { isBlogLayout: true }),
  T("store-layout", { isCommerceLayout: true }),
  T("lesson-design", { isLmsPageDesign: true }),
  T("listing", { marketplaceStatus: "PUBLISHED" }),
];

describe("which templates are sites on the new dashboard", () => {
  it("includes every real kind of site", () => {
    const sites = summarizeSites([...real, ...notSites], []);
    expect(sites.map((s) => s.id).sort()).toEqual(real.map((r) => r.id).sort());
  });
  it("excludes layouts, emails, listings and sub-pages", () => {
    for (const t of notSites) expect(isRealSite(t), t.id).toBe(false);
  });
  it("names the kind in plain words and remembers where a moved site came from", () => {
    const by = Object.fromEntries(summarizeSites(real, []).map((s) => [s.id, s]));
    expect(by.app.kind).toBe("App with sign-in");
    expect(by.funnel.kind).toBe("Course");
    expect(by.raw.kind).toBe("Uploaded page");
    expect(by.wp.movedFrom).toBe("https://muzingo.com");
    expect(by.wp.name).toBe("Muzingo | Online Music Bingo Game");
  });
  it("marks a site live only with an active address in this workspace, preferring the custom domain", () => {
    const sites = summarizeSites(real, [
      { templateId: "builder", domain: "a.plexopages.com", type: "FREE", active: true, organizationId: "o1" },
      { templateId: "builder", domain: "mine.com", type: "CUSTOM", active: true, organizationId: "o1" },
      { templateId: "raw", domain: "off.plexopages.com", active: false, organizationId: "o1" },
      { templateId: "app", domain: "x.plexopages.com", active: true, organizationId: "other" },
    ], "o1");
    const by = Object.fromEntries(sites.map((s) => [s.id, s]));
    expect(by.builder).toMatchObject({ status: "live", address: "mine.com" });
    expect(by.raw.status).toBe("draft");
    expect(by.app.status).toBe("draft");
  });
  it("a person with many sites always has sites, never an empty list", () => {
    const many = Array.from({ length: 40 }, (_, i) => T(`s${i}`, { sourceType: i % 2 ? "RAW_UPLOAD" : "BUILDER" }));
    expect(summarizeSites([...many, ...notSites], [])).toHaveLength(40);
  });
});
