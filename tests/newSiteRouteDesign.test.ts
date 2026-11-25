import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  made: { siteId: "s1", name: "Aria Kitchen", designApplied: true } as { siteId: string; name: string; designApplied?: boolean; warnings?: string[] },
  calls: [] as Array<[string, unknown[]]>,
}));
const note = (name: string, ...args: unknown[]) => { h.calls.push([name, args]); };

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "o1" }) }));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { buildProfile: { goal: "business-site", brand: { name: "Aria", colors: ["#112233"], logoUrl: "https://x/profile-logo.png" } } } }) }) } }));
vi.mock("@/lib/marketplaceUse", () => ({ MarketplaceUseError: class extends Error { status = 400; extra = {}; } }));
vi.mock("@/lib/onboarding/siteMaking", () => ({
  makeSiteFromMarketDesign: async (...a: unknown[]) => { note("make", ...a); return h.made; },
  makeSiteFromKit: async (...a: unknown[]) => { note("kit", ...a); return h.made; },
  applyApprovedHtml: async (...a: unknown[]) => { note("approved", ...a); return { saved: true, designData: "synced", problems: [], unmatched: [{ from: "a", to: "b" }] }; },
  applyOwnerLook: async (...a: unknown[]) => { note("look", ...a); return { applied: null, problems: [] }; },
  markSolPersonalized: async (...a: unknown[]) => { note("mark", ...a); },
}));
vi.mock("@/lib/onboarding/complete", () => ({ siteCreateArgs: () => ({ kit: true }) }));
vi.mock("@/lib/brand/siteBrand", () => ({ applyNewSiteBrandChoice: async () => ({ ok: true }) }));
vi.mock("@/lib/strata/autoSetupBackground", () => ({ setUpBrandInBackground: () => {} }));

import { POST } from "@/app/api/dashboard/new-site/route";

const send = async (extra: Record<string, unknown>) => {
  const res = await POST(new Request("http://x/api/dashboard/new-site", { method: "POST", body: JSON.stringify({ goal: "business-site", name: "Aria Kitchen", about: "We bake fresh sourdough and cakes every morning in Lagos.", brandColor: "#2255ee", ...extra }) }) as never);
  return { status: res.status, json: (await res.json()) as { warnings: string[]; site: { id: string } } };
};
const called = (name: string) => h.calls.filter(([n]) => n === name);

beforeEach(() => {
  h.calls = [];
  h.made = { siteId: "s1", name: "Aria Kitchen", designApplied: true };
});

describe("Create my website for a new-editor design", () => {
  it("builds the site from the listing with the owner's recipe, and carries NO page HTML back (no diffing, nothing 'unmatched')", async () => {
    const { status, json } = await send({ marketDesignId: "d1", designEdits: { copy: { "1": "Fresh sourdough" }, remove: ["t"], domain: "food", contact: true, slotsKey: "0123456789abcdef" }, personalizedHtml: "<h1>Sneaky page</h1>", brandLogoUrl: "https://x/logo.png" });
    expect(status).toBe(200);
    const [id, name, brand, opts] = called("make")[0][1].slice(1) as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect([id, name]).toEqual(["d1", "Aria Kitchen"]);
    expect(brand).toMatchObject({ logoUrl: "https://x/logo.png" }); // the logo the preview showed is the logo the site keeps
    expect(opts).toMatchObject({ applyLook: false, design: { about: "We bake fresh sourdough and cakes every morning in Lagos.", copy: { "1": "Fresh sourdough" }, remove: ["t"], domain: "food", contact: true } });
    expect(called("approved")).toHaveLength(0);
    expect(called("look")).toHaveLength(1); // the colour and logo come from the site's Brand tab, applied once
    expect(called("mark")[0][1]).toEqual(["s1", { contact: true }]);
    expect(json.warnings).toEqual([]);
  });

  it("with no SOL, still builds from the design and never marks the site as SOL's", async () => {
    await send({ marketDesignId: "d1", brandedHtml: "<h1>Branded</h1>" });
    expect(called("approved")).toHaveLength(0);
    expect(called("mark")).toHaveLength(0);
    expect(called("make")).toHaveLength(1);
  });

  it("keeps the page-text fallback for a design that is not a new-editor one, with its notice", async () => {
    h.made = { siteId: "s1", name: "Aria Kitchen", designApplied: false };
    const { json } = await send({ marketDesignId: "d1", personalizedHtml: "<h1>SOL page</h1>" });
    expect(called("approved")).toHaveLength(1);
    expect(called("approved")[0][1][1]).toBe("<h1>SOL page</h1>");
    expect(called("mark")).toHaveLength(1); // the fallback path saves the SOL markers on the site too
    expect(called("look")).toHaveLength(0); // applyApprovedHtml applied it
    expect(json.site.id).toBe("s1");
  });

  it("ignores a recipe sent for a kit design (no marketplace design, nothing to rebuild)", async () => {
    await send({ designId: "home-simple", designEdits: { copy: { "1": "x" } } });
    expect(called("kit")).toHaveLength(1);
    expect(called("make")).toHaveLength(0);
    expect(called("mark")).toHaveLength(0);
  });
});
