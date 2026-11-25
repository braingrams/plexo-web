import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, any>> })); // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.rows[id] ?? null }) }),
    patch: ({ id }: { id: string }) => ({ set: (v: Record<string, unknown>) => ({ go: async () => { h.rows[id] = { ...h.rows[id], ...v }; return {}; } }) }),
  },
}));

vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: null }) }) } }));
vi.mock("@/lib/plan/limitGates", () => ({ templateLimitGate: () => null }));
vi.mock("@/lib/plan/planGate", () => ({ planGateBody: (_c: string, m: string) => ({ error: m }) }));
vi.mock("@/lib/storage", () => ({ uploadObject: async () => ({ url: "u" }) }));
vi.mock("@/lib/subscription", () => ({ getTierFeatures: () => ({}) }));
vi.mock("@/server/templateNameDynamo", () => ({ ensureUniqueTemplateName: async ({ base }: { base: string }) => base }));
vi.mock("@/lib/siteLayoutCore", () => ({ compileTemplateWithSiteLayout: async () => "" }));
vi.mock("@/lib/sites/applyLook", () => ({ applySiteLook: async () => ({}), applySiteLogo: async () => ({}) }));
vi.mock("@/lib/mcp/siteTools", () => ({ handleSiteTool: async () => ({}) }));
vi.mock("@/lib/v2/designSystemStore", () => ({ resolveDesignSystem: async (d: unknown) => d }));
vi.mock("@/lib/v2/compile", () => ({ compileV2Design: async () => "" }));
vi.mock("@charisol/plexo-sdk/v2/compile", () => ({}));
import { markSolPersonalized } from "@/lib/onboarding/siteMaking";
import { solContactOf, solPersonalizedOf } from "@/lib/dashboardV3/solMarks";
import { computeTasks, EMPTY_FACTS } from "@/lib/dashboardV3/tasks";

beforeEach(() => {
  h.rows = { s1: { id: "s1", compiledHtml: "<html><body>Hi</body></html>", draftHtml: "<html><body>Draft</body></html>" } };
});

describe("SOL personalization is saved on the site row", () => {
  it("writes the timestamps (and the contact one only when given), keeping the HTML markers", async () => {
    await markSolPersonalized("s1");
    expect(h.rows.s1.solPersonalizedAt).toBeTruthy();
    expect(h.rows.s1.solContactGivenAt).toBeUndefined();
    expect(h.rows.s1.compiledHtml).toContain('data-sol-personalized="true"');
    h.rows.s3 = { id: "s3", compiledHtml: "<html><body>Hi</body></html>" };
    await markSolPersonalized("s3", { contact: true });
    expect(h.rows.s3.solContactGivenAt).toBeTruthy();
    expect(h.rows.s3.compiledHtml).toContain('data-sol-contact="true"');
  });

  it("writes the fields even when the site has no HTML yet", async () => {
    h.rows.s2 = { id: "s2" };
    await markSolPersonalized("s2", { contact: true });
    expect(h.rows.s2.solPersonalizedAt).toBeTruthy();
    expect(h.rows.s2.solContactGivenAt).toBeTruthy();
  });

  it("readers return true from the fields alone (HTML without markers)", () => {
    const t = { solPersonalizedAt: "2026-01-01T00:00:00Z", solContactGivenAt: "2026-01-01T00:00:00Z", compiledHtml: "<html><body>x</body></html>", draftHtml: "<html></html>" };
    expect(solPersonalizedOf(t)).toBe(true);
    expect(solContactOf(t)).toBe(true);
  });

  it("legacy HTML markers still work, and an unmarked site is false", () => {
    expect(solPersonalizedOf({ compiledHtml: '<body data-sol-personalized="true">' })).toBe(true);
    expect(solPersonalizedOf({ draftHtml: '<body data-sol-personalized="true">' })).toBe(true);
    expect(solContactOf({ draftHtml: '<body data-sol-personalized="true" data-sol-contact="true">' })).toBe(true);
    expect(solPersonalizedOf({ compiledHtml: "<body>" })).toBe(false);
    expect(solContactOf(null)).toBe(false);
  });

  it("the checklist step stays done after a recompile drops the markers", async () => {
    await markSolPersonalized("s1", { contact: true });
    h.rows.s1.compiledHtml = "<html><body>recompiled</body></html>"; // what the editor's recompile does
    h.rows.s1.draftHtml = "<html><body>recompiled</body></html>";
    const facts = { ...EMPTY_FACTS, hasSite: true, personalizedWithSol: solPersonalizedOf(h.rows.s1), contactProvided: solContactOf(h.rows.s1) };
    expect(facts.personalizedWithSol).toBe(true);
    expect(facts.contactProvided).toBe(true);
    const tasks = computeTasks("business", facts);
    expect(tasks.tasks.find((t) => t.id === "words")?.state).toBe("done");
    expect(tasks.tasks.find((t) => t.id === "contact")?.state).toBe("done");
  });
});
