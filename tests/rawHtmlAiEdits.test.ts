import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Editing an uploaded HTML page with AI used to ask for the whole page back — a one-word
// change cost as many credits as rewriting the page. Now the AI returns only the changes and
// Plexo applies them; the editor still gets the complete document.

const ai = vi.hoisted(() => ({ answers: [] as string[], prompts: [] as string[] }));
vi.mock("@/lib/ai/providers/anthropic", () => ({
  generate: vi.fn(async (p: { userPrompt: string }) => {
    ai.prompts.push(p.userPrompt);
    const text = ai.answers.shift() ?? "";
    return { text, usage: { inputTokens: 100, outputTokens: Math.ceil(text.length / 4) }, truncated: false };
  }),
}));
vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generate: vi.fn() }));
vi.mock("@/lib/ai/providers/gemini", () => ({ generate: vi.fn() }));
vi.mock("@/lib/ai/providers/openai", () => ({ generate: vi.fn() }));
// The page sanitizer pulls in the auth stack; raw HTML editing doesn't use it.
vi.mock("@/server/sanitizer", async () => {
  const { z } = await import("zod");
  return { ElementJSONSchema: z.any(), TemplateJSONSchema: z.any(), hydrateStructuralDefaults: (x: unknown) => x };
});
const { answers, prompts } = ai;

import { applyHtmlEdits, generateBuilderAction, RawHtmlEditError } from "@/lib/ai/generate";

const page = `<!DOCTYPE html><html><head><title>Cafe</title></head><body><h1>Welcome</h1><p class="lead">Fresh coffee</p><p class="lead">Open daily</p></body></html>`;
const edit = (prompt: string) =>
  generateBuilderAction({ mode: "edit_raw_html", prompt, templateKind: "LANDING_PAGE", context: { html: page }, provider: "anthropic_claude", apiKey: "k", tier: "BASIC" } as never);

beforeEach(() => {
  ai.answers.length = 0;
  ai.prompts.length = 0;
});

describe("applyHtmlEdits", () => {
  it("applies edits in order", () => {
    expect(applyHtmlEdits(page, [{ find: "<h1>Welcome</h1>", replace: "<h1>Hello</h1>" }, { find: "Open daily", replace: "Open 7–7" }])).toBe(page.replace("Welcome", "Hello").replace("Open daily", "Open 7–7"));
  });

  it("keeps $ sequences in new markup literal", () => {
    expect(applyHtmlEdits(page, [{ find: "Fresh coffee", replace: "From $& $1" }])).toContain("From $& $1");
  });

  it("refuses a find that's missing or not unique, so nothing lands in the wrong place", () => {
    expect(() => applyHtmlEdits(page, [{ find: "<h2>", replace: "" }])).toThrow(RawHtmlEditError);
    expect(() => applyHtmlEdits(page, [{ find: '<p class="lead">', replace: "<p>" }])).toThrow(/more than once/);
  });
});

describe("AI edits to an uploaded page", () => {
  it("the AI sends only the change; the editor gets the whole page", async () => {
    answers.push(JSON.stringify({ summary: "Changed the heading", result: { edits: [{ find: "<h1>Welcome</h1>", replace: "<h1>Hello</h1>" }] } }));
    const out = await edit("Change the heading to Hello");
    expect(out.result).toBe(page.replace("Welcome", "Hello"));
    // Charged on what the AI wrote: the change, not the page.
    expect(out.usage!.outputTokens).toBeLessThan(Math.ceil(page.length / 4));
  });

  it("an edit that can't be applied is sent back with the reason, and the retry is used", async () => {
    answers.push(JSON.stringify({ summary: "x", result: { edits: [{ find: '<p class="lead">', replace: "<p>" }] } }));
    answers.push(JSON.stringify({ summary: "Simplified the first line", result: { edits: [{ find: '<p class="lead">Fresh coffee</p>', replace: "<p>Fresh coffee</p>" }] } }));
    const out = await edit("Drop the lead style from the first line");
    expect(prompts[1]).toMatch(/couldn't be applied: edit 1 .* matches more than once/);
    expect(out.result).toBe(page.replace('<p class="lead">Fresh coffee</p>', "<p>Fresh coffee</p>"));
  });

  it("a page-wide rewrite can still come back whole", async () => {
    answers.push(JSON.stringify({ summary: "Redesigned", result: { html: "<!DOCTYPE html><html><body>New</body></html>" } }));
    expect((await edit("Redesign everything")).result).toBe("<!DOCTYPE html><html><body>New</body></html>");
  });
});
