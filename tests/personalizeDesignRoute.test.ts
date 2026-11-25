import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  afford: null as null | { error: string },
  provider: [] as string[],
  charged: 0,
  canAfford: 0,
}));

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "o1" }) }));
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.rows[id] ?? null }) }) } }));
vi.mock("@/lib/v2/designSystemStore", () => ({ resolveDesignSystem: async (d: unknown) => d }));
vi.mock("@/lib/v2/compile", () => ({ compileV2Design: async (d: { pages: unknown[] }) => `<html data-from-design>${JSON.stringify(d.pages)}</html>` }));
vi.mock("@/lib/db/ledgerOperations", () => ({ ensureCreditPeriod: async () => ({ available: 480, total: 500 }), estimateWorstCaseCost: () => 20 }));
vi.mock("@/lib/ai/solEngine", () => ({
  solRouteForUser: async () => ({ route: { provider: "bedrock_claude", apiKey: "k", paidBy: "plexo" }, plan: "pro" }),
  tierFor: () => "BASIC",
  checkCanAfford: async () => {
    h.canAfford++;
    return h.afford;
  },
  chargeFor: async () => {
    h.charged++;
  },
}));
vi.mock("@/lib/ai/generate", () => ({ callProvider: async () => ({ text: h.provider.shift() ?? "{}", usage: { inputTokens: 10, outputTokens: 10 } }) }));
vi.mock("@/lib/ai/modelRegistry", () => ({ resolveModel: () => "model" }));
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
}));

import { POST } from "@/app/api/onboarding/personalize/route";

const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const design = () => ({
  format: "plexo-v2@1",
  pages: [{ id: "p1", name: "Home", slug: "", rootNode: { id: "root", type: "page", children: [
    section("h", "header", { brand: "Iron & Grain", logo: "" }),
    section("a", "hero", { headline: "Iron & Grain builds strength", sub: "Open daily until late for everyone nearby who wants to lift" }),
    section("t", "testimonials", { items: [{ name: "Jane Doe", quote: "Best gym in town, truly" }] }),
    section("f", "footer", { copyright: "© 2026 Iron & Grain" }),
  ] } }],
});
const listing = (more: Record<string, unknown> = {}) => ({ id: "d1", name: "Iron & Grain: strength gym", kind: "LANDING_PAGE", sourceType: "BUILDER", designFormat: "v2", marketplaceStatus: "PUBLISHED", marketplaceDescription: "A gym", designJson: design(), ...more });
const profile = { goal: "business-site", brand: { name: "Aria Kitchen", about: "We bake fresh sourdough and cakes every morning in Lagos.", colors: ["#2255ee"], logoUrl: "https://x/logo.png" } };
const call = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("http://x/api/onboarding/personalize", { method: "POST", body: JSON.stringify({ profile, ...body }) }) as never);
  return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

beforeEach(() => {
  h.rows = { d1: listing() };
  h.afford = null;
  h.provider = [];
  h.charged = 0;
  h.canAfford = 0;
});

describe("personalize route on a new-editor design", () => {
  it("previews the design with the owner's name from the DESIGN data, with no SOL and no charge", async () => {
    const { status, json } = await call({ stage: "preview", designId: "d1" });
    expect(status).toBe(200);
    expect(json.html).toContain("data-from-design");
    expect(json.html).toContain("Aria Kitchen builds strength");
    expect(json.html).not.toContain("Iron & Grain builds");
    expect(json.designToken).toMatch(/^[a-f0-9]{16}$/);
    expect(h.canAfford).toBe(0);
    expect(h.charged).toBe(0);
  });

  it("never reads design JSON or HTML from the browser: the source is the listing", async () => {
    const { json } = await call({ stage: "preview", designId: "d1", templateHtml: "<h1>Browser page</h1>", designJson: { pages: [] } });
    expect(json.html).toContain("Aria Kitchen builds strength");
    expect(json.html).not.toContain("Browser page");
  });

  it("plan: checks affordability first, charges once, and returns the numbered words and what SOL may remove", async () => {
    h.provider = [JSON.stringify({ domain: "food", summary: "I will write your bakery's words.", questions: [], remove: [1, 7] })];
    const { status, json } = await call({ stage: "plan", designId: "d1" });
    expect(status).toBe(200);
    expect(h.canAfford).toBe(1);
    expect(h.charged).toBe(1);
    expect(json).toMatchObject({ domain: "food", slotCount: 6, remove: ["t"] });
    expect(json.slotsKey).toMatch(/^[a-f0-9]{16}$/);
  });

  it("plan: answers 402 with the plain credits message and does not call SOL when the owner cannot afford it", async () => {
    h.afford = { error: "no" };
    const { status, json } = await call({ stage: "plan", designId: "d1" });
    expect(status).toBe(402);
    expect(json.outOfCredits).toBe(true);
    expect(json.error).toContain("SOL needs more credits");
    expect(h.charged).toBe(0);
  });

  it("write: SOL's words come back keyed by number, in small batches", async () => {
    h.provider = [JSON.stringify({ r: { "1": "Fresh sourdough, baked for Lagos", "99": "never shown" } })];
    const { json } = await call({ stage: "write", designId: "d1", ids: [0, 1, 2] });
    expect(h.canAfford).toBe(1);
    expect(h.charged).toBe(1);
    expect(json.replacements).toEqual({ "1": "Fresh sourdough, baked for Lagos" });
  });

  it("finish: puts SOL's words into the design (not the HTML), recompiles from it, and hands back the recipe; no charge", async () => {
    const plan = (await (async () => { h.provider = [JSON.stringify({ domain: "food", summary: "", questions: [], remove: [1] })]; return call({ stage: "plan", designId: "d1" }); })()).json;
    const charged = h.charged;
    const { status, json } = await call({ stage: "finish", designId: "d1", replacements: { "1": "Fresh sourdough, baked for Lagos" }, remove: plan.remove, slotsKey: plan.slotsKey, domain: "food", answers: [{ question: "What is your phone number?", answer: "+234 801 234 5678" }] });
    expect(status).toBe(200);
    expect(json.html).toContain("Fresh sourdough, baked for Lagos");
    expect(json.html).not.toContain("Jane Doe"); // the testimonials section SOL chose to remove is gone from the design
    expect(json.edits).toMatchObject({ copy: { "1": "Fresh sourdough, baked for Lagos" }, remove: ["t"], domain: "food", contact: true });
    expect(json.creditsRemaining).toBe(480);
    expect(h.charged).toBe(charged);
    expect(h.canAfford).toBe(1);
  });

  it("falls back to the page-text path for a design that is not a new-editor one", async () => {
    h.rows = { d1: listing({ designFormat: "v1" }) };
    const missing = await call({ stage: "plan", designId: "d1" });
    expect(missing.status).toBe(400);
    expect(missing.json.error).toContain("Pick a design first");
    const preview = await call({ stage: "preview", designId: "d1" });
    expect(preview.status).toBe(400);
    h.provider = [JSON.stringify({ domain: "other", summary: "", questions: [] })];
    const html = await call({ stage: "plan", designId: "d1", templateHtml: "<h1>Hello world</h1><p>Some words here</p>" });
    expect(html.status).toBe(200);
    expect(html.json.slotCount).toBeUndefined();
  });
});
