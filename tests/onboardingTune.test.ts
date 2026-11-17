import { describe, expect, it } from "vitest";
import { defaultTuneSite, tuneDraft, tuneSolHref } from "@/lib/onboarding/tune";
import type { SiteSummary } from "@/lib/dashboardV3/sites";

const sites: SiteSummary[] = [
  { id: "a", name: "Old shop", kind: "Online store", status: "live", updatedAt: "2026-01-01" },
  { id: "b", name: "Muzingo | Online Music Bingo Game", kind: "Uploaded page", status: "draft", updatedAt: "2026-05-01" },
];

describe("tune Plexo to you (existing owners)", () => {
  it("pre-selects the most recently edited site, or the one they chose before", () => {
    expect(defaultTuneSite(sites)?.id).toBe("b");
    expect(defaultTuneSite(sites, "a")?.id).toBe("a");
    expect(defaultTuneSite([])).toBeNull();
  });
  it("seeds SOL with the site and tells it to look first", () => {
    const d = tuneDraft(sites[1], "words", "keep it short");
    expect(d).toContain("Muzingo | Online Music Bingo Game");
    expect(d).toContain("site id b");
    expect(d).toMatch(/find_page.*page_describe/);
    expect(d).toContain("improve the words");
    expect(d).toContain("keep it short");
  });
  it("works with only free text, or nothing", () => {
    expect(tuneDraft(sites[0], "", "Add a gift card page")).toContain("Add a gift card page");
    expect(tuneDraft(sites[0], "", "")).toContain("what you'd improve first");
  });
  it("builds a safe SOL link", () => {
    const href = tuneSolHref(sites[0], "fix", 'a "quote" & more');
    expect(href.startsWith("/dashboard/sol?new=1&draft=")).toBe(true);
    expect(href).not.toMatch(/[ "]/);
  });
});
