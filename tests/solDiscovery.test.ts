import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({ dispatchMcpTool: vi.fn(), PLEXO_MCP_TOOLS: [] }));
vi.mock("@/lib/ai/solAttachments", () => ({ createAttachmentResolver: () => async (h: unknown) => h, publishAttachedImage: vi.fn(), PRIVATE_ATTACHMENT_PATH: "private/sol-attachments/" }));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generateWithTools: vi.fn() }));

import { buildSolSystemPrompt } from "@/lib/ai/solAgent";
import { PALETTES, QUALITY_BAR, SAVE_BRAND_GUIDE, briefFromConversation, creativeDirection, directionSummary, discoveryPrompt, paletteKeyForTone } from "@/lib/ai/solDiscovery";
import { QUESTION_TEXT, parseBrief, planQuestions } from "@/lib/ai/solBrief";
import cases from "./fixtures/solEvalPrompts.json";

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text", text }] });
const prompt = (text: string, profile?: Parameters<typeof briefFromConversation>[1]) => {
  const { brief, plan } = briefFromConversation([user(text)], profile);
  return { brief, plan, text: discoveryPrompt(brief, plan) };
};

// WCAG relative luminance contrast
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe("palettes are accessible", () => {
  for (const [key, p] of Object.entries(PALETTES)) {
    it(`${key}: text reads on background and soft sections, white reads on the primary button`, () => {
      expect(contrast(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#FFFFFF", p.primary)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("picks a palette from the tone and industry", () => {
    expect(paletteKeyForTone("elegant", undefined)).toBe("elegant");
    expect(paletteKeyForTone(undefined, "law firm")).toBe("elegant");
    expect(paletteKeyForTone("bold, dark", undefined)).toBe("bold");
    expect(paletteKeyForTone(undefined, undefined)).toBe("warm");
  });
});

describe("creative direction", () => {
  it("uses the owner's own colours as the palette and keeps text readable", () => {
    const d = creativeDirection(parseBrief({ text: "Build a landing page for Zed Tech. Colours #0F766E and #F59E0B." }));
    expect(d.palette.source).toBe("brand");
    expect(d.palette.roles[0].value).toBe("#0F766E");
    expect(d.palette.roles.map((r) => r.role).join(" ")).toMatch(/background/);
  });
  it("sorts the owner's colours into roles: light is the background, dark is the text", () => {
    const d = creativeDirection(parseBrief({ text: "Landing page for Crumb. Colours: terracotta #C2410C, cream #FFF8F1 and deep brown #3B2314." }));
    const role = (r: string) => d.palette.roles.find((x) => x.role.startsWith(r))?.value;
    expect(role("primary")).toBe("#C2410C");
    expect(role("background")).toBe("#FFF8F1");
    expect(role("text")).toBe("#3B2314");
  });
  it("plans a rich page with a job per section, not a skeleton", () => {
    const d = creativeDirection(parseBrief({ text: "build me a landing page" }));
    expect(d.sectionPlan.length).toBeGreaterThanOrEqual(6);
    expect(d.sectionPlan.map((s) => s.section).join(" ")).toMatch(/hero[\s\S]*FAQ[\s\S]*final CTA[\s\S]*footer/);
    expect(d.sectionPlan.every((s) => s.job.length > 10)).toBe(true);
  });
  it("designs a wordmark when there is no logo, never an empty image slot", () => {
    const d = creativeDirection(parseBrief({ text: "landing page for Glow Studio, no logo" }));
    expect(d.logo).toMatch(/wordmark/);
    expect(d.logo).toMatch(/Never leave an empty image slot/);
  });
  it("respects the sections the owner listed", () => {
    const rich = cases.find((c) => c.id === "rich-brief")!.text;
    const d = creativeDirection(parseBrief({ text: rich }));
    expect(d.sectionPlan.map((s) => s.section)).toContain("custom cake order form");
    expect(d.typography.heading).toBe("Fraunces");
  });
  it("summarises in plain words with no tool jargon", () => {
    const text = directionSummary(creativeDirection(parseBrief({ text: "build me a landing page" })));
    expect(text).not.toMatch(/JSON|templateId|slug|site_create/);
  });
});

describe("prompt assembly", () => {
  it("a thin prompt hands SOL the exact intake card and forbids building first", () => {
    const p = prompt("build me a landing page");
    expect(p.text).toContain("Your FIRST action is one ask_user_question call");
    for (const k of ["offer", "name", "audience", "cta", "tone", "brand"] as const) expect(p.text).toContain(QUESTION_TEXT[k]);
    expect(p.text).toContain("Creative direction");
    expect(p.text).toContain("Do not ask a second round");
  });
  it("a rich brief gets no intake card, but every fact flows through", () => {
    const p = prompt(cases.find((c) => c.id === "rich-brief")!.text);
    expect(p.text).not.toContain("Your FIRST action");
    expect(p.text).toContain("do not ask a question round");
    for (const needle of ["Crumb & Co", "#C2410C", "hello@crumbandco.com", "+233 24 123 4567", "Fresh from our oven to your Saturday.", "GHS 45", "wordmark", "Fraunces"]) expect(p.text).toContain(needle);
  });
  it("brand facts from the site flow through and are not asked", () => {
    const p = prompt("make me a landing page for our cake subscription", { brand: { name: "Ama's Bakery" }, currentSite: { id: "s1", brand: { colors: ["#1F6F4A"], logoUrl: "https://cdn.example/l.png" } } });
    expect(p.text).toContain("Ama's Bakery");
    expect(p.text).toContain("#1F6F4A");
    expect(p.text).toContain("from their site's brand");
    expect(p.text).toContain("I'll use your brand (name, colours, logo)");
    expect(p.text).not.toContain(QUESTION_TEXT.brand);
    expect(p.text).not.toContain(QUESTION_TEXT.name);
  });
  it("just-build-it states assumptions to be said in one line", () => {
    const p = prompt("make me a landing page for dog walking, just build it");
    expect(p.text).toContain("They told you to just build it");
    expect(p.text).toContain("I assumed");
  });
  it("answers from the card end the intake and are used", () => {
    const history = [
      user("build me a landing page"),
      { role: "assistant" as const, content: [{ type: "tool_use", id: "t1", name: "ask_user_question", input: {} }] },
      { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: `Q: ${QUESTION_TEXT.offer}\nA: We bake cakes in Accra\n\nQ: ${QUESTION_TEXT.name}\nA: Ama's Cakes\n\nQ: ${QUESTION_TEXT.tone}\nA: ${"Skip, you choose"}` }] },
    ];
    const { brief, plan } = briefFromConversation(history);
    expect(plan.mode).toBe("build");
    expect(plan.reason).toBe("already-asked");
    expect(brief.name.value).toBe("Ama's Cakes");
    const text = discoveryPrompt(brief, plan);
    expect(text).toContain("Ama's Cakes");
    expect(text).not.toContain("Your FIRST action");
  });
  it("changes to existing work add nothing", () => {
    const history = [user("build me a landing page"), { role: "assistant" as const, content: [{ type: "tool_use", id: "t", name: "site_create", input: {} }] }, user("make the buttons green")];
    const { brief, plan } = briefFromConversation(history);
    expect(discoveryPrompt(brief, plan)).toBe("");
  });
  it("tells SOL to write in the owner's language", () => {
    expect(prompt(cases.find((c) => c.id === "fr-boulangerie")!.text).text).toContain("in French, and ask the questions and options in that language too");
  });
  it("the full system prompt carries the quality bar, the save-brand guide and this request's block", () => {
    const { brief, plan } = briefFromConversation([user("build me a landing page")]);
    const sys = buildSolSystemPrompt([], undefined, { discovery: discoveryPrompt(brief, plan) });
    expect(sys).toContain(QUALITY_BAR.slice(0, 60));
    expect(sys).toContain("Welcome to Our Website");
    expect(sys).toContain(SAVE_BRAND_GUIDE.slice(0, 40));
    expect(sys).toContain("Your FIRST action is one ask_user_question call");
    expect(sys).toContain("site_save_look");
    // keeps the token cost sensible: the whole addition for a thin prompt stays small
    expect(discoveryPrompt(brief, plan).length + QUALITY_BAR.length + SAVE_BRAND_GUIDE.length).toBeLessThan(9000);
  });
});

describe("question plan is stable across the eval set", () => {
  it("never asks more than the cap for the level", () => {
    for (const c of cases) {
      const input = { text: c.text };
      const b = parseBrief(input);
      const n = planQuestions(b, input).questions.length;
      expect(n).toBeLessThanOrEqual(b.richness.level === "rich" ? 1 : b.richness.level === "medium" ? 4 : 6);
    }
  });
});
