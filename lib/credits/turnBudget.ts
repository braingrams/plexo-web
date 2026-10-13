import { computeCostUsd, creditsForUsd } from "@/lib/credits/pricing";
import { MAX_TOKENS } from "@/lib/ai/generate";
import type { AiProvider, ConcreteTier } from "@/lib/ai/types";

/**
 * The most a SOL turn could still bill if it makes one more model call: what its earlier
 * rounds have already used (not yet billed — a turn is billed once, at the end) plus the
 * next round's worst case. The turn holds exactly that much on the account before each call
 * (holdCredits in lib/db/ledgerOperations.ts); if the hold can't be placed it stops there.
 *
 * Two things this has to get right, both of which an earlier check got wrong (a Free user,
 * 200 credits, ran up 422): the spend so far counts even though it isn't billed yet, and the
 * next round is sized by what it will really send — the whole conversation, the system prompt
 * and every tool definition are resent each round, not just the user's latest message.
 */
export type TokenUsage = { inputTokens: number; outputTokens: number };

/** What the agent loop knows when it asks "may I make another call?". */
export type TurnProgress = {
  /** Tokens already used by this turn's earlier rounds (not yet billed). */
  spent: TokenUsage;
  /** The previous round's real usage — the next round resends at least that much — or null before round 1. */
  lastRound: TokenUsage | null;
  /** Characters about to be sent: system prompt + tool definitions + the conversation so far. */
  nextInputChars: number;
  /** Output ceiling for the next call when it isn't the turn's usual one (e.g. the short wrap-up summary). */
  maxOutputTokens?: number;
};

// Same conservative ~3 characters per token estimateWorstCaseCost uses.
const CHARS_PER_TOKEN = 3;

export function turnCreditCeiling(params: {
  provider: AiProvider;
  tier: ConcreteTier;
  progress: TurnProgress;
  /** The turn's usual per-round output ceiling (shorter for Free accounts on Plexo's AI). */
  maxOutputTokens?: number;
}): number {
  const { provider, tier, progress } = params;
  const spentCredits = creditsForUsd(computeCostUsd(provider, tier, progress.spent));
  const fromText = Math.ceil(progress.nextInputChars / CHARS_PER_TOKEN);
  const fromLastRound = progress.lastRound ? progress.lastRound.inputTokens + progress.lastRound.outputTokens : 0;
  const nextRoundCredits = creditsForUsd(
    computeCostUsd(provider, tier, {
      inputTokens: Math.max(fromText, fromLastRound),
      outputTokens: progress.maxOutputTokens ?? params.maxOutputTokens ?? MAX_TOKENS.agent_chat,
    }),
  );
  return spentCredits + nextRoundCredits;
}
