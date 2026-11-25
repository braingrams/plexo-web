import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the site's rows, so the real siteMaking logic (reading the page and its shared header/footer, syncing the
// preview into their design data, putting the owner's brand into the design) runs without a database.
const h = vi.hoisted(() => {
  const state = { rows: {} as Record<string, any>, layouts: {} as Record<string, any>, events: [] as string[], lookCalls: [] as any[], logoCalls: [] as any[], lookResult: { updated: 1, needsPublish: 1, skipped: 0, logoPlaced: true } as any };
  return state;
});

vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.rows[id] ?? null }) }),
    patch: ({ id }: { id: string }) => ({
      set: (v: Record<string, unknown>) => ({
        go: async () => {
          h.events.push(`patch:${id}:${Object.keys(v).join(",")}`);
          h.rows[id] = { ...h.rows[id], ...v };
          return {};
        },
      }),
    }),
  },
  SiteLayout: { get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.layouts[templateId] ?? null }) }) },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { name: "Ada" } }) }) } }));
vi.mock("@/lib/sites/applyLook", () => ({
  applySiteLook: async (input: any) => {
    h.events.push("look");
    h.lookCalls.push(input);
    return h.lookResult;
  },
  applySiteLogo: async (input: any) => {
    h.events.push("logo");
    h.logoCalls.push(input);
    return { placed: true };
  },
}));
vi.mock("@/lib/mcp/siteTools", () => ({ handleSiteTool: async () => ({ siteId: "s1", name: "Kit" }) }));
vi.mock("@/lib/marketplaceUse", () => ({ useMarketplaceTemplate: async () => ({ id: "s1", name: "Market" }) }));

import { applyApprovedHtml, applyOwnerLook, makeSiteFromMarketDesign } from "@/lib/onboarding/siteMaking";

const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const v2 = (...sections: unknown[]) => ({ format: "plexo-v2@1", pages: [{ id: "p1", name: "Home", slug: "", rootNode: { id: "root", type: "page", children: sections } }] });
const contentOf = (d: any, i = 0) => d.pages[0].rootNode.children[i].props.block.content;
const ORIGINAL = "<html><head><style>.b{background:#e0b040}</style></head><body><a class=\"logo\">Iron &amp; Grain</a><h1>Strength starts here</h1><p>Open daily</p></body></html>";
const FINAL = "<html><head><style>.b{background:#2255ee}</style></head><body><a class=\"logo\">Aria</a><h1>Strength starts at Aria</h1><p>Open daily</p></body></html>";
const who = { userId: "u1", organizationId: "o1" };

beforeEach(() => {
  h.rows = {};
  h.layouts = {};
  h.events = [];
  h.lookCalls = [];
  h.logoCalls = [];
  h.lookResult = { updated: 1, needsPublish: 1, skipped: 0, logoPlaced: true };
});

const site = (extra: Record<string, unknown> = {}) => ({ id: "s1", organizationId: "o1", designFormat: "v2", compiledHtml: ORIGINAL, designJson: v2(section("a", "hero", { headline: "Strength starts here", note: "Open daily" })), ...extra });

describe("applyApprovedHtml", () => {
  it("saves the approved page, syncs the page AND the shared header and footer, and reports nothing when all was found", async () => {
    h.rows.s1 = site();
    h.rows.hd = { id: "hd", organizationId: "o1", designFormat: "v2", designJson: v2(section("h", "header", { brand: "Iron & Grain" })) };
    h.rows.ft = { id: "ft", organizationId: "o1", designFormat: "v2", designJson: v2(section("f", "footer", { about: "Open daily" })) };
    h.layouts.s1 = { headerTemplateId: "hd", footerTemplateId: "ft" };
    const r = await applyApprovedHtml("s1", FINAL, { brandColor: "#2255ee" });
    expect(r).toMatchObject({ saved: true, designData: "synced", problems: [], unmatched: [] });
    expect(h.rows.s1.compiledHtml).toBe(FINAL);
    expect(h.rows.s1.draftHtml).toBe(FINAL);
    expect(contentOf(h.rows.s1.designJson).headline).toBe("Strength starts at Aria");
    expect(contentOf(h.rows.hd.designJson).brand).toBe("Aria");
    expect(h.lookCalls).toHaveLength(0); // a kit site is already built in the brand: nothing more to apply
  });

  it("returns what it could not place, in plain words", async () => {
    h.rows.s1 = site({ designJson: v2(section("a", "hero", { headline: "Something else", note: "Open daily" })) });
    const r = await applyApprovedHtml("s1", FINAL);
    expect(r.unmatched?.length).toBeGreaterThan(0);
    expect(r.problems.join(" ")).toContain("couldn't be filled in automatically");
    expect(r.problems.join(" ")).toContain("Review and edit your pages");
  });

  it("puts the brand into a design whose brand is kept in storage, then puts the approved page back (colour no longer 'stays in a library')", async () => {
    const ref = { hash: "a".repeat(64), size: 900_000 };
    h.rows.s1 = site({ designJson: { ...v2(section("a", "hero", { headline: "Strength starts here" })), designSystemRef: ref }, brand: { colors: ["#112233"], noLogo: true } });
    const r = await applyApprovedHtml("s1", FINAL, { brandColor: "#2255ee", look: who });
    expect(r.problems.join(" ")).not.toMatch(/library/i);
    expect(h.lookCalls).toHaveLength(1);
    expect(h.lookCalls[0].look.colors).toEqual(["#2255EE", "#112233"]);
    expect(h.rows.s1.brand.colors[0]).toBe("#2255EE"); // the site's brand now says the colour the site uses
    expect(h.rows.s1.designJson.designSystemRef).toEqual(ref);
    // the page the owner approved is saved again after the brand was applied (applying it rebuilds pages from their data)
    const lookAt = h.events.indexOf("look");
    expect(h.events.slice(lookAt + 1).some((e) => e.startsWith("patch:s1:compiledHtml,draftHtml"))).toBe(true);
    expect(h.rows.s1.compiledHtml).toBe(FINAL);
  });

  it("leaves a classic page as the approved HTML only", async () => {
    h.rows.s1 = site({ designFormat: "v1" });
    const r = await applyApprovedHtml("s1", FINAL, { look: who });
    expect(r).toMatchObject({ saved: true, designData: "not-applicable" });
    expect(h.lookCalls).toHaveLength(0);
  });

  it("does not fail the site when the design data can't be read", async () => {
    h.rows.s1 = site({ designJson: { nope: true } });
    const r = await applyApprovedHtml("s1", FINAL);
    expect(r.saved).toBe(true);
    expect(r.designData).toBe("failed");
    expect(r.problems.join(" ")).toContain("until you save the page once");
  });
});

describe("applyOwnerLook: the site's brand is the one source", () => {
  it("applies the brand the Brand page would, and saves a new main colour first", async () => {
    h.rows.s1 = site({ brand: { colors: ["#112233"], logoUrl: "https://x/logo.png" } });
    const r = await applyOwnerLook("s1", who, { brandColor: "#2255ee" });
    expect(h.lookCalls[0]).toMatchObject({ siteId: "s1", organizationId: "o1", userName: "Ada", look: { colors: ["#2255EE", "#112233"], logoUrl: "https://x/logo.png", logoSkipped: false } });
    expect(h.rows.s1.brand).toMatchObject({ colors: ["#2255EE", "#112233"], logoUrl: "https://x/logo.png" });
    expect(r.problems).toEqual([]);
  });

  it("with no colour at all, only places the logo", async () => {
    h.rows.s1 = site({ brand: { logoUrl: "https://x/logo.png" } });
    const r = await applyOwnerLook("s1", who, {});
    expect(h.lookCalls).toHaveLength(0);
    expect(h.logoCalls).toEqual([{ organizationId: "o1", siteId: "s1", logoUrl: "https://x/logo.png" }]);
    expect(r.problems).toEqual([]);
  });

  it("does nothing when the site has no brand yet", async () => {
    h.rows.s1 = site();
    expect(await applyOwnerLook("s1", who, {})).toEqual({ applied: null, problems: [] });
    expect(h.events).toEqual([]);
  });

  it("says plainly when the design can't be recoloured, and when the logo has no place", async () => {
    h.rows.s1 = site({ brand: { colors: ["#112233"], logoUrl: "https://x/logo.png" } });
    h.lookResult = { updated: 0, needsPublish: 0, skipped: 1, logoPlaced: false };
    expect((await applyOwnerLook("s1", who, {})).problems[0]).toContain("can't be recoloured automatically");
    h.lookResult = { updated: 2, needsPublish: 2, skipped: 0, logoPlaced: false };
    expect((await applyOwnerLook("s1", who, {})).problems[0]).toContain("no place for it in the header");
  });
});

describe("a marketplace design made by onboarding", () => {
  it("saves the brand on the site and applies it to the design in the same step", async () => {
    h.rows.s1 = site({ brand: undefined });
    const out = await makeSiteFromMarketDesign({ userId: "u1", organizationId: "o1" } as any, "d1", "Aria", { colors: ["#2255ee"], logoUrl: "https://x/logo.png" } as any);
    expect(out).toEqual({ siteId: "s1", name: "Market" });
    expect(h.rows.s1.brand.colors).toEqual(["#2255EE"]);
    expect(h.lookCalls).toHaveLength(1);
  });

  it("applyLook:false leaves it to the caller (the new-site flow applies it after saving the previewed page)", async () => {
    h.rows.s1 = site();
    await makeSiteFromMarketDesign({ userId: "u1", organizationId: "o1" } as any, "d1", "Aria", { colors: ["#2255ee"] } as any, { applyLook: false });
    expect(h.lookCalls).toHaveLength(0);
  });
});
