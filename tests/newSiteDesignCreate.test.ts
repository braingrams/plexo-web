import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the site rows, so the REAL marketplace "use" path, the real design edit and the real recompile run without a database.
const h = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, any>>, purchases: new Set<string>(), compiles: 0 })); // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.rows[id] ?? null }) }),
    create: (row: Record<string, unknown>) => ({ go: async () => { h.rows[row.id as string] = { ...row }; return {}; } }),
    patch: ({ id }: { id: string }) => ({ set: (v: Record<string, unknown>) => ({ go: async () => { h.rows[id] = { ...h.rows[id], ...v }; return {}; } }) }),
    query: { byOrg: () => ({ go: async () => ({ data: [] }) }) },
  },
  TemplateAsset: { query: { primary: () => ({ go: async () => ({ data: [] }) }) }, create: () => ({ go: async () => ({}) }) },
  TemplatePurchase: { get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.purchases.has(templateId) ? { templateId } : null }) }) },
  SiteLayout: { get: () => ({ go: async () => ({ data: null }) }) },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { name: "Ada" } }) }) } }));
vi.mock("@/lib/plan/limitGates", () => ({ templateLimitGate: () => ({ code: "x", message: "limit", requiredPlan: "pro", details: {} }) }));
vi.mock("@/lib/plan/planGate", () => ({ planGateBody: (_c: string, m: string) => ({ error: m }) }));
vi.mock("@/lib/storage", () => ({ uploadObject: async () => ({ url: "u" }) }));
vi.mock("@/lib/subscription", () => ({ getTierFeatures: () => ({ maxLandingPages: 10, maxEmailTemplates: 10 }) }));
vi.mock("@/server/templateNameDynamo", () => ({ ensureUniqueTemplateName: async ({ base }: { base: string }) => base }));
// What the real recompile does, in miniature: the page is built from the row's design data (and from nothing else).
vi.mock("@/lib/siteLayoutCore", () => ({
  compileTemplateWithSiteLayout: async (row: { designJson: unknown }) => {
    h.compiles++;
    return `<html><body>${JSON.stringify(row.designJson)}</body></html>`;
  },
}));
vi.mock("@/lib/sites/applyLook", () => ({ applySiteLook: async () => ({ updated: 1, needsPublish: 1, skipped: 0, logoPlaced: true }), applySiteLogo: async () => ({ placed: true }) }));
vi.mock("@/lib/mcp/siteTools", () => ({ handleSiteTool: async () => ({ siteId: "s1", name: "Kit" }) }));
vi.mock("@/lib/v2/designSystemStore", () => ({ resolveDesignSystem: async (d: unknown) => d }));
vi.mock("@/lib/v2/compile", () => ({ compileV2Design: async () => "<html></html>" }));
vi.mock("@charisol/plexo-sdk/v2/compile", () => ({
  createDefaultDesignSystem: () => ({ tokens: [], components: [] }),
  parsePages: (pages: unknown) => ({ ok: true, pages }),
  repairDesignSystem: (d: unknown) => d,
  applyCommands: (pages: unknown, ds: unknown) => ({ pages, designSystem: ds, results: [{ ok: true, message: "" }] }),
  blankPages: () => [],
  buildPageFromTemplate: () => ({}),
  templateSeed: () => "",
  starterEmailPages: () => [],
  MAX_CUSTOM_JS: 100000,
  convertV1Design: () => ({ page: { rootNode: { children: [] } } }),
  describeDesign: () => ({ pages: [{ sections: [] }] }),
}));

import { MarketplaceUseError } from "@/lib/marketplaceUse";
import { makeSiteFromMarketDesign, markSolPersonalized } from "@/lib/onboarding/siteMaking";
import { recompileCopiedV2Page } from "@/lib/v2/copy";
import { listSlots } from "@/lib/onboarding/designSlots";
import { slotsKeyOf } from "@/lib/onboarding/designEdit";

const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const designJson = () => ({
  format: "plexo-v2@1",
  meta: { htmlTitle: "Iron & Grain: strength gym" },
  pages: [{ id: "p1", name: "Home", slug: "", rootNode: { id: "root", type: "page", children: [
    section("h", "header", { brand: "Iron & Grain", logo: "" }),
    section("a", "hero", { headline: "Iron & Grain builds strength", sub: "Open daily until late for everyone nearby who wants to lift", tagline: "" }),
    section("t", "testimonials", { items: [{ name: "Jane Doe", quote: "Best gym in town, truly" }] }),
    section("c", "cta", { label: "Learn more" }),
    section("f", "footer", { copyright: "© 2026 Iron & Grain" }),
  ] } }],
});
const listing = (more: Record<string, unknown> = {}) => ({ id: "d1", name: "Iron & Grain: strength gym", kind: "LANDING_PAGE", sourceType: "BUILDER", designFormat: "v2", marketplaceStatus: "PUBLISHED", priceCents: 0, designJson: designJson(), compiledHtml: "<html>SAMPLE Iron & Grain</html>", ...more });
const who = { userId: "u1", organizationId: "o1", subscriptionPlan: "free" } as never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pageOf = (id: string) => (h.rows[id].designJson as any).pages[0].rootNode.children;

beforeEach(() => {
  h.rows = { d1: listing() };
  h.purchases = new Set();
  h.compiles = 0;
});

describe("a site made from a new-editor design with SOL's words", () => {
  const slots = () => listSlots([{ role: "page", design: designJson() }]);
  const at = (text: string) => String(slots().findIndex((s) => s.text === text));
  const recipe = () => ({
    about: "We bake fresh sourdough and cakes every morning in Lagos.",
    slotsKey: slotsKeyOf(slots()),
    copy: { [at("Iron & Grain builds strength")]: "Fresh sourdough, baked for Lagos", [at("Learn more")]: "See the menu", [String(slots().findIndex((s) => s.empty))]: "Baked before sunrise" },
    remove: ["t"],
    contact: true,
  });

  it("holds SOL's copy, the owner's name and the removal in the editor's design data from the first moment", async () => {
    const made = await makeSiteFromMarketDesign(who, "d1", "Aria Kitchen", undefined, { applyLook: false, design: recipe() });
    expect(made.designApplied).toBe(true);
    const content = (i: number) => pageOf(made.siteId)[i].props.block.content;
    expect(content(0).brand).toBe("Aria Kitchen");
    expect(content(1).headline).toBe("Fresh sourdough, baked for Lagos");
    expect(content(1).tagline).toBe("Baked before sunrise"); // text SOL added where the design had nothing to match
    expect(content(2).label).toBe("See the menu");
    expect(pageOf(made.siteId).map((c: { id: string }) => c.id)).toEqual(["h", "a", "c", "f"]); // a section SOL chose to drop
    expect(h.rows[made.siteId].designJson.meta.htmlTitle).toBe("Aria Kitchen: strength gym");
    expect(h.rows.d1.designJson).toEqual(designJson()); // the listing itself is never touched
  });

  it("survives the recompile: the page is built from that design (no sample words come back), now and on every later recompile", async () => {
    const made = await makeSiteFromMarketDesign(who, "d1", "Aria Kitchen", undefined, { applyLook: false, design: recipe() });
    const html = () => h.rows[made.siteId].compiledHtml as string;
    expect(h.compiles).toBe(1); // one recompile at creation
    expect(html()).toContain("Fresh sourdough, baked for Lagos");
    expect(html()).not.toContain("SAMPLE");
    expect(html()).not.toContain("Jane Doe");
    expect(html()).not.toContain("Iron & Grain builds");
    await recompileCopiedV2Page(made.siteId); // what any later save does
    expect(html()).toContain("Fresh sourdough, baked for Lagos");
    expect(html()).toContain("See the menu");
    expect(html()).not.toContain("Iron & Grain builds");
  });

  it("marks the site as personalized by SOL in the HTML the dashboard checklist reads (and that the owner gave contact details)", async () => {
    h.rows.s9 = { id: "s9", compiledHtml: "<html><body class=\"x\">Hi</body></html>", draftHtml: "<html><body>Draft</body></html>" };
    await markSolPersonalized("s9", { contact: true });
    expect(h.rows.s9.compiledHtml).toContain('data-sol-personalized="true" data-sol-contact="true"');
    expect(h.rows.s9.draftHtml).toContain('data-sol-personalized="true"');
    await markSolPersonalized("s9", { contact: true });
    expect((h.rows.s9.compiledHtml.match(/data-sol-personalized/g) ?? []).length).toBe(1);
  });

  it("with no SOL words, still puts the owner's name and description in the design (a plain 'Create my website')", async () => {
    const made = await makeSiteFromMarketDesign(who, "d1", "Aria Kitchen", undefined, { applyLook: false, design: { about: "We bake fresh sourdough and cakes every morning in Lagos." } });
    expect(pageOf(made.siteId)[1].props.block.content.headline).toBe("Aria Kitchen builds strength");
    expect(pageOf(made.siteId)[1].props.block.content.sub).toBe("We bake fresh sourdough and cakes every morning in Lagos.");
    expect(h.rows[made.siteId].compiledHtml).toContain("Aria Kitchen builds strength");
  });

  it("re-checks that a paid design is owned before anything is derived from it", async () => {
    h.rows = { d1: listing({ priceCents: 2900 }) };
    await expect(makeSiteFromMarketDesign(who, "d1", "Aria Kitchen", undefined, { applyLook: false, design: recipe() })).rejects.toBeInstanceOf(MarketplaceUseError);
    expect(Object.keys(h.rows)).toEqual(["d1"]);
    h.purchases.add("d1");
    const made = await makeSiteFromMarketDesign(who, "d1", "Aria Kitchen", undefined, { applyLook: false, design: recipe() });
    expect(made.designApplied).toBe(true);
  });

  it("copies a classic design as it is and says it was not applied, so the page-text fallback can run", async () => {
    h.rows = { d1: listing({ designFormat: "v1", designJson: { body: { rows: [] } } }) };
    const made = await makeSiteFromMarketDesign(who, "d1", "Aria Kitchen", undefined, { applyLook: false, design: recipe() });
    expect(made.designApplied).toBe(false);
    expect(h.rows[made.siteId].designJson).toEqual({ body: { rows: [] } });
  });
});
