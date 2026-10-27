import { describe, it, expect, vi } from "vitest";

// turnBudget reads the output ceiling from the AI module, which pulls in the database client — not needed for pure maths.
vi.mock("@/lib/ai/generate", () => ({ MAX_TOKENS: { agent_chat: 32_000 } }));

import { turnCreditCeiling, type TokenUsage } from "@/lib/credits/turnBudget";
import { computeCostUsd, creditsForUsd } from "@/lib/credits/pricing";

const provider = "bedrock_claude" as const;
const tier = "BASIC" as const;
const credits = (u: TokenUsage) => creditsForUsd(computeCostUsd(provider, tier, u));
const FREE_CAP = 12_000; // FREE_SOL_MAX_ANSWER_TOKENS
const progress = (o: Partial<Parameters<typeof turnCreditCeiling>[0]["progress"]> = {}) => ({
  spent: { inputTokens: 0, outputTokens: 0 }, lastRound: null, nextInputChars: 3_000, ...o,
});

describe("turnCreditCeiling — the most a SOL turn could still bill", () => {
  it("counts what earlier rounds already used, even though a turn is only billed at the end", () => {
    const fresh = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress() });
    const spent = { inputTokens: 90_000, outputTokens: 6_000 };
    const later = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress({ spent }) });
    expect(later - fresh).toBe(credits(spent));
  });

  it("sizes the next round from the whole conversation + tools, not just the user's message", () => {
    const small = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress({ nextInputChars: 300 }) });
    const withToolsAndHistory = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress({ nextInputChars: 150_000 }) });
    expect(withToolsAndHistory).toBeGreaterThan(small + 30);
  });

  it("never sizes the next round below what the last one really sent", () => {
    const fromText = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress({ nextInputChars: 3_000 }) });
    const afterBigRound = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress({ nextInputChars: 3_000, lastRound: { inputTokens: 400_000, outputTokens: 5_000 } }) });
    expect(afterBigRound).toBeGreaterThan(fromText + 300);
  });

  it("uses the cheap output cap for the short wrap-up summary", () => {
    const normal = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress() });
    const wrapUp = turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: progress({ maxOutputTokens: 1024 }) });
    expect(wrapUp).toBeLessThan(normal);
  });

  it("stops a long turn on a 200-credit Free account instead of letting it run past it (the -222 incident)", () => {
    const FIXED_CHARS = 90_000; // system prompt + ~100 tool definitions, resent every round
    let spent: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let last: TokenUsage | null = null;
    let history = 2_000;
    let rounds = 0;
    for (let i = 0; i < 40; i++) {
      const nextInputChars = FIXED_CHARS + history;
      // what the turn would hold; it may only proceed if the account can cover it
      if (turnCreditCeiling({ provider, tier, maxOutputTokens: FREE_CAP, progress: { spent, lastRound: last, nextInputChars } }) > 200) break;
      const round = { inputTokens: Math.ceil(nextInputChars / 3) + 1_000, outputTokens: 1_500 }; // what the provider really bills
      spent = { inputTokens: spent.inputTokens + round.inputTokens, outputTokens: spent.outputTokens + round.outputTokens };
      last = round;
      history += 12_000;
      rounds++;
    }
    expect(rounds).toBeGreaterThanOrEqual(1); // an account with credits still gets to work
    expect(rounds).toBeLessThan(40);
    expect(credits(spent)).toBeLessThanOrEqual(200); // and the turn is billed inside the balance
  });
});
