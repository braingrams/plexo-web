import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/lib/mcp/dispatchMcpTool", () => ({ dispatchMcpTool: vi.fn(), PLEXO_MCP_TOOLS: [] }));
vi.mock("@/lib/ai/solAttachments", () => ({ createAttachmentResolver: () => async (h: unknown) => h, publishAttachedImage: vi.fn(), PRIVATE_ATTACHMENT_PATH: "private/sol-attachments/" }));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generateWithTools: vi.fn() }));

import { buildSolSystemPrompt, solPreferencesPrompt } from "@/lib/ai/solAgent";
import { solBuildProfilePrompt } from "@/lib/ai/solBuildContext";
import { MAX_SITE_TOOL_ITERATIONS, MAX_TOOL_ITERATIONS, SITE_BUILD_TOOLS } from "@/lib/credits/agentTurnEstimate";

describe("SOL's prompt: plan-first and creative", () => {
  const prompt = buildSolSystemPrompt([]);

  it("asks one compact round of questions for something new, then plans, then builds", () => {
    expect(prompt).toMatch(/ONE ask_user_question card/);
    expect(prompt).toMatch(/This request/);
    expect(prompt).toMatch(/Plan, briefly \(the creative direction\)/);
    expect(prompt).toMatch(/Then build it straight away/);
    expect(prompt).toMatch(/Never ask for things you can default/);
  });

  it("builds whole sites with site_create and knows the new tools", () => {
    for (const tool of ["site_create", "list_site_templates", "create_site_from_template", "find_page", "page_create_from_template", "page_edit", "page_publish", "sell_product_on_page"]) expect(prompt).toContain(tool);
    expect(prompt).toMatch(/several connected pages, not one landing page/);
  });

  it("has a builder decision rule: visual by default, React app for accounts/data, raw HTML only for own code", () => {
    expect(prompt).toMatch(/Visual builder \(the default\)/);
    expect(prompt).toMatch(/React app\*\* when they need/);
    expect(prompt).toMatch(/sign(ing)? in, accounts, dashboards/);
    expect(prompt).toMatch(/Hand-written HTML\*\* only when they bring their own code/);
    expect(prompt).not.toMatch(/never offer the owner a choice between builders/);
  });

  it("keeps owners away from jargon and is honest about credits", () => {
    expect(prompt).toMatch(/Never put technical words in your replies/);
    expect(prompt).toMatch(/Be honest about credits/);
  });

  it("adds nothing when there are no preferences or profile", () => {
    expect(prompt).not.toContain("## How this owner wants you to work");
    expect(prompt).not.toContain("## What this owner is building");
  });
});

describe("the owner's SOL settings reach the prompt", () => {
  it("injects tone, length and custom instructions", () => {
    const p = buildSolSystemPrompt([], undefined, { preferences: { tonePreset: "PROFESSIONAL", responseLength: "CONCISE", customInstructions: "Always use British spelling." } });
    expect(p).toContain("## How this owner wants you to work");
    expect(p).toMatch(/polished, professional voice/);
    expect(p).toMatch(/Keep replies short/);
    expect(p).toContain("Always use British spelling.");
  });

  it("leaves out a balanced length and empty instructions", () => {
    expect(solPreferencesPrompt({ tonePreset: null, responseLength: "BALANCED", customInstructions: "  " })).toBe("");
    expect(solPreferencesPrompt(undefined)).toBe("");
  });

  it("caps custom instructions", () => {
    expect(solPreferencesPrompt({ customInstructions: "x".repeat(5000) }).length).toBeLessThan(2400);
  });
});

describe("build profile", () => {
  it("is empty without a profile", () => {
    expect(solBuildProfilePrompt(undefined)).toBe("");
    expect(solBuildProfilePrompt({})).toBe("");
  });

  it("tells SOL what it already knows, so it doesn't re-ask", () => {
    const block = solBuildProfilePrompt({ goal: "store", experience: "intermediate", brand: { name: "Crumbs", about: "Celebration cakes in Lagos", industry: "bakery", tone: "warm", colors: ["#B4441C", "cream"], logoUrl: "https://cdn.test/logo.png" } });
    expect(block).toContain('Business name: "Crumbs"');
    expect(block).toContain("an online store");
    expect(block).toContain('"#B4441C", "cream"');
    expect(block).toContain("https://cdn.test/logo.png");
    expect(block).toMatch(/don't ask for them again/);
    expect(block).toMatch(/site_create with a store page/);
  });

  it("speaks plainly to beginners and briefly to pros", () => {
    expect(solBuildProfilePrompt({ experience: "beginner" })).toMatch(/plain, everyday words/);
    expect(solBuildProfilePrompt({ experience: "pro" })).toMatch(/brief and precise/);
  });

  it("is part of the system prompt", () => {
    const p = buildSolSystemPrompt([], undefined, { profile: { goal: "blog", brand: { name: "Ada Writes" } } });
    expect(p).toContain("## What this owner is building (from their onboarding)");
    expect(p).toContain('"Ada Writes"');
  });

  it("drops a logo that isn't a web address and caps long values", () => {
    const block = solBuildProfilePrompt({ brand: { logoUrl: "javascript:alert(1)", about: "a".repeat(1000) } });
    expect(block).not.toContain("javascript:");
    expect(block.length).toBeLessThan(1200);
  });
});

describe("site builds get more steps", () => {
  it("raises the step limit for site tools", () => {
    expect(MAX_SITE_TOOL_ITERATIONS).toBeGreaterThan(MAX_TOOL_ITERATIONS);
    expect(SITE_BUILD_TOOLS.has("site_create")).toBe(true);
    expect(SITE_BUILD_TOOLS.has("create_site_from_template")).toBe(true);
  });
});
