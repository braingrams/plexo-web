import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SOL's one set of AI rules (lib/ai/solEngine.ts), used by every AI feature.

vi.mock("@/lib/crypto", () => ({
  decryptSecret: (v: string) => {
    if (v === "broken") throw new Error("bad");
    return `plain:${v}`;
  },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { subscriptionPlan: plan, stripeSubscriptionId: "sub_1", subscriptionStatus: "ACTIVE" } }) }) } }));
vi.mock("@/lib/ai/resolveUserAiKey", () => ({ resolveActiveApiKeyForUser: async () => activeKey }));
vi.mock("@/lib/db/ledgerOperations", () => ({ chargeUsage: vi.fn(), ensureCreditPeriod: async () => ({ total: 100, available: 100 }), estimateWorstCaseCost: () => 500 }));

let plan = "FREE";
let activeKey: Record<string, unknown> | null = null;

import { routeForKey, tierFor, lockedTierFor, checkCanAfford, maxAnswerTokensFor, FREE_SOL_MAX_ANSWER_TOKENS } from "@/lib/ai/solEngine";

beforeEach(() => vi.stubEnv("SYSTEM_AI_PROVIDER", "bedrock_claude"));
afterEach(() => {
  vi.unstubAllEnvs();
  plan = "FREE";
  activeKey = null;
});

describe("SOL engine", () => {
  it("follows the Settings → AI choice", () => {
    expect(routeForKey(null)).toMatchObject({ provider: "bedrock_claude", paidBy: "plexo" });
    expect(routeForKey({ aiAccessMode: "BYOK", aiApiKey: "k", aiProvider: "openai" })).toEqual({ provider: "openai", apiKey: "plain:k", paidBy: "own-key" });
    // Chose Plexo's AI, even with an old key still saved → Plexo's AI.
    expect(routeForKey({ aiAccessMode: "SYSTEM", aiApiKey: "k", aiProvider: "openai" })).toMatchObject({ paidBy: "plexo" });
    // Saved before the choice existed → their own key, as always.
    expect(routeForKey({ aiAccessMode: undefined, aiApiKey: "k", aiProvider: "openai" })).toMatchObject({ paidBy: "own-key" });
  });

  it("says plainly when a saved key can't be read, instead of charging credits", () => {
    expect(routeForKey({ aiAccessMode: "BYOK", aiApiKey: "broken", aiProvider: "openai" })).toMatchObject({ status: 500 });
  });

  it("explains when Plexo's AI isn't set up", () => {
    vi.stubEnv("SYSTEM_AI_PROVIDER", "");
    expect(routeForKey(null)).toMatchObject({ status: 503 });
  });

  it("runs Free accounts on Plexo's AI on Basic — not own-key or paid plans", () => {
    const plexo = { provider: "bedrock_claude" as const, apiKey: "", paidBy: "plexo" as const };
    const own = { provider: "openai" as const, apiKey: "k", paidBy: "own-key" as const };
    expect(tierFor(plexo, "FREE", "HIGH")).toBe("BASIC");
    expect(tierFor(own, "FREE", "HIGH")).toBe("HIGH");
    expect(tierFor(plexo, "PRO", "MEDIUM")).toBe("MEDIUM");
  });

  it("locks the chat's model only for Free on Plexo's AI", async () => {
    expect(await lockedTierFor("u")).toMatchObject({ tier: "BASIC" });
    activeKey = { aiAccessMode: "BYOK", aiApiKey: "k", aiProvider: "openai" };
    expect(await lockedTierFor("u")).toBeNull();
    activeKey = null;
    plan = "ULTRA";
    expect(await lockedTierFor("u")).toBeNull();
  });

  it("only checks credits for Plexo's AI", async () => {
    const plexo = { provider: "bedrock_claude" as const, apiKey: "", paidBy: "plexo" as const };
    expect(await checkCanAfford("u", plexo, "BASIC", "import_products", 100)).toMatchObject({ status: 402 });
    expect(await checkCanAfford("u", { ...plexo, paidBy: "own-key" }, "BASIC", "import_products", 100)).toBeNull();
  });

  it("gives Free accounts on Plexo's AI shorter answers per SOL round", () => {
    const plexo = { provider: "bedrock_claude" as const, apiKey: "", paidBy: "plexo" as const };
    expect(maxAnswerTokensFor(plexo, "FREE")).toBe(FREE_SOL_MAX_ANSWER_TOKENS);
    expect(maxAnswerTokensFor(plexo, "PRO")).toBeUndefined();
    expect(maxAnswerTokensFor({ ...plexo, paidBy: "own-key" }, "FREE")).toBeUndefined();
  });
});
