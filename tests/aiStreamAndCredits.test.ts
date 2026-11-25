import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// The provider writes the page in pieces (as a real stream does); each test decides what it answers.
const provider = vi.hoisted(() => ({ answers: [] as { text: string; truncated: boolean }[], calls: [] as number[] }));
vi.mock("@/lib/ai/providers/anthropic", () => ({
  generate: vi.fn(async (p: { maxTokens: number; onTextDelta?: (d: string) => void }) => {
    provider.calls.push(p.maxTokens);
    const answer = provider.answers.shift()!;
    for (let i = 0; i < answer.text.length; i += 10) p.onTextDelta?.(answer.text.slice(i, i + 10));
    return { text: answer.text, usage: { inputTokens: 100, outputTokens: 1000 }, truncated: answer.truncated };
  }),
}));

vi.mock("@/lib/ai/providers/bedrockClaude", () => ({ generate: vi.fn() }));
vi.mock("@/lib/ai/providers/gemini", () => ({ generate: vi.fn() }));
vi.mock("@/lib/ai/providers/openai", () => ({ generate: vi.fn() }));
// The page sanitizer pulls in the auth stack; raw HTML generation doesn't use it.
vi.mock("@/server/sanitizer", async () => {
  const { z } = await import("zod");
  return { ElementJSONSchema: z.any(), TemplateJSONSchema: z.any(), hydrateStructuralDefaults: (x: unknown) => x };
});

import { GenerationStoppedError, generateBuilderAction } from "@/lib/ai/generate";

const page = JSON.stringify({ summary: "A coffee shop page", result: "<!doctype html><html><body>Coffee</body></html>" });
const base = { provider: "anthropic_claude" as const, tier: "BASIC", apiKey: "k", mode: "generate_raw_html" as const, prompt: "A coffee shop", templateKind: "LANDING_PAGE" as const, context: null };

describe("AI generation progress and credit checks", () => {
  beforeEach(() => {
    provider.answers = [];
    provider.calls = [];
  });

  it("reports how much has been written as the page streams in", async () => {
    provider.answers = [{ text: page, truncated: false }];
    const seen: number[] = [];
    const out = await generateBuilderAction({ ...base, onProgress: (p) => seen.push(p.characters) });
    expect(out.summary).toBe("A coffee shop page");
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.at(-1)).toBe(page.length);
  });

  it("re-checks before the bigger retry, and both calls' usage is counted", async () => {
    provider.answers = [{ text: page.slice(0, 20), truncated: true }, { text: page, truncated: false }];
    const checks: [number, number][] = [];
    const out = await generateBuilderAction({ ...base, beforeAttempt: async (maxTokens, attempt) => void checks.push([maxTokens, attempt]) });
    expect(checks).toEqual([[32000, 1], [provider.calls[1], 2]]);
    expect(provider.calls[1]).toBeGreaterThan(32000);
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 2000 });
  });

  it("stops before the retry when the account can't afford it — and says so in plain words", async () => {
    provider.answers = [{ text: page.slice(0, 20), truncated: true }, { text: page, truncated: false }];
    const stop = generateBuilderAction({
      ...base,
      beforeAttempt: async (_m, attempt) => {
        if (attempt > 1) throw new GenerationStoppedError("Your page needed a longer answer than your remaining credits cover.");
      },
    });
    await expect(stop).rejects.toThrow(/remaining credits/);
    expect(provider.calls).toHaveLength(1); // the AI was never called a second time
  });
});
