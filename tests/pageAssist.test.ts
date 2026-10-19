import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

const s = vi.hoisted(() => ({
  route: { provider: "bedrock_claude", apiKey: "k", paidBy: "plexo" } as { provider: string; apiKey: string; paidBy: string },
  plan: "PRO",
  afford: null as null | { status: number; error: string },
  held: true,
  providerFails: false,
  truncated: false,
  chargeFails: false,
  calls: { charge: [] as unknown[], release: [] as unknown[], hold: [] as unknown[], provider: [] as unknown[] },
}));

vi.mock("@/lib/ai/solEngine", () => ({
  solRouteForUser: async () => ({ route: s.route, plan: s.plan }),
  tierFor: (_r: unknown, plan: string, tier: string) => (plan === "FREE" && s.route.paidBy === "plexo" ? "BASIC" : tier),
  checkCanAfford: async () => s.afford,
}));
vi.mock("@/lib/db/ledgerOperations", () => ({
  estimateWorstCaseCost: () => 42,
  holdCredits: async (...a: unknown[]) => { s.calls.hold.push(a); return { held: s.held, available: 0 }; },
  releaseHold: async (...a: unknown[]) => { s.calls.release.push(a); },
  chargeUsage: async (...a: unknown[]) => { s.calls.charge.push(a); if (s.chargeFails) throw new Error("db down"); return {}; },
}));
vi.mock("@/lib/ai/generate", () => ({
  MAX_TOKENS: { page_assist: 8000 },
  callProvider: async (...a: unknown[]) => {
    s.calls.provider.push(a);
    if (s.providerFails) throw new Error("boom");
    const onDelta = a[6] as (d: string) => void;
    onDelta("Making the headline ");
    onDelta("bolder.");
    return { text: "Making the headline bolder.", usage: { inputTokens: 10, outputTokens: 5 }, truncated: s.truncated };
  },
}));

import { PAGE_ASSIST_NOTES, parseAssistBody, prepareAssist, type AssistFrame } from "@/lib/ai/pageAssist";

const body = { question: "Refine typography hierarchy for mobile", context: { nodeType: "text", nodeName: "Headline", pageId: "p1", design: { pages: [] }, catalog: { kinds: [] } } };

async function run(b: unknown = body) {
  const prepared = await prepareAssist("u1", b);
  if ("refused" in prepared) return prepared.refused;
  const frames: AssistFrame[] = [];
  await prepared.run((f) => frames.push(f));
  return frames;
}

beforeEach(() => {
  s.route = { provider: "bedrock_claude", apiKey: "k", paidBy: "plexo" };
  s.plan = "PRO"; s.afford = null; s.held = true; s.providerFails = false; s.truncated = false; s.chargeFails = false;
  s.calls = { charge: [], release: [], hold: [], provider: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SOL in the editor (page assistant)", () => {
  it("asks for a question in plain words", () => {
    expect(parseAssistBody({ question: "  " })).toEqual({ status: 400, error: "Type what you'd like SOL to do first." });
    expect(parseAssistBody(null)).toMatchObject({ status: 400 });
  });

  it("refuses a site too big to read, and keeps only the last few turns of history", () => {
    expect(parseAssistBody({ question: "x", context: { design: "y".repeat(500_000) } })).toMatchObject({ status: 413 });
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "sol" : "you", text: `t${i}` }));
    const ok = parseAssistBody({ question: "x", history: [...many, { role: "robot", text: "no" }, 7] }) as { input: { history: unknown[] } };
    expect(ok.input.history).toHaveLength(8);
  });

  it("streams the words as tokens, then done, and bills the real usage releasing the hold", async () => {
    const out = await run();
    expect(out).toEqual([{ type: "token", text: "Making the headline " }, { type: "token", text: "bolder." }, { type: "done" }]);
    expect(s.calls.hold).toHaveLength(1);
    const [uid, charge] = s.calls.charge[0] as [string, { mode: string; usage: unknown; releaseHoldId: string }];
    expect(uid).toBe("u1");
    expect(charge).toMatchObject({ mode: "page_assist", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(charge.releaseHoldId).toBe((s.calls.hold[0] as unknown[])[1]);
  });

  it("tells SOL what is selected, the page and the brand, and that changes are applied live", async () => {
    await run();
    const [, , , system, user] = s.calls.provider[0] as string[];
    expect(system).toContain(PAGE_ASSIST_NOTES);
    expect(system).toContain("plexo-commands");
    expect(user).toContain('the selected text ("Headline")');
    expect(user).toContain("Refine typography hierarchy for mobile");
    expect(user).toContain("Open page id: p1");
  });

  it("not enough credits is refused before anything streams, nothing is held", async () => {
    s.afford = { status: 402, error: "You don't have enough AI credits for this." };
    expect(await run()).toEqual({ status: 402, error: "You don't have enough AI credits for this." });
    expect(s.calls.hold).toHaveLength(0);
  });

  it("credits already held by other running work refuse politely", async () => {
    s.held = false;
    expect(await run()).toMatchObject({ status: 402 });
    expect(s.calls.provider).toHaveLength(0);
  });

  it("an account on its own key is never billed or held", async () => {
    s.route = { provider: "openai", apiKey: "mine", paidBy: "own-key" };
    expect((await run() as AssistFrame[]).at(-1)).toEqual({ type: "done" });
    expect(s.calls.hold).toHaveLength(0);
    expect(s.calls.charge).toHaveLength(0);
  });

  it("a provider failure arrives as a plain error frame and frees the hold", async () => {
    s.providerFails = true;
    const out = (await run()) as AssistFrame[];
    expect(out.at(-1)).toMatchObject({ type: "error" });
    expect(JSON.stringify(out.at(-1))).toContain("SOL couldn't answer that");
    expect(s.calls.release).toHaveLength(1);
    expect(s.calls.charge).toHaveLength(0);
  });

  it("a billing hiccup after the answer streamed does not turn it into an error", async () => {
    s.chargeFails = true;
    const out = (await run()) as AssistFrame[];
    expect(out.at(-1)).toEqual({ type: "done" });
    expect(s.calls.release).toHaveLength(1);
  });

  it("a cut-off answer says so", async () => {
    s.truncated = true;
    const out = (await run()) as AssistFrame[];
    expect(JSON.stringify(out.at(-1))).toContain("cut off");
  });
});
