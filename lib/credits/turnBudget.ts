import { computeCostUsd, creditsForUsd } from "@/lib/credits/pricing";
import { MAX_TOKENS } from "@/lib/ai/generate";
import type { AiProvider, ConcreteTier } from "@/lib/ai/types";

/**
 * Whether SOL may start another model round in the current turn.
 *
 * A turn is billed once, when it ends — so the saved balance doesn't move while the turn is
 * running. A check that only reads that balance sees the full allowance on every round and
 * can never say stop: one long turn on a 200-credit Free account ran up 422 credits of real
 * Bedrock cost before the end-of-turn bill landed (a -222 balance, paid for by Plexo). So the
 * check must take what THIS turn has already spent off the balance first, and size the next
 * round by what it will really send — the whole conversation, the system prompt and every
 * tool definition are resent each round, not just the user's latest message.
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

export function canAffordNextRound(params: {
  provider: AiProvider;
  tier: ConcreteTier;
  /** The account's saved balance (allowance + top-ups). */
  balanceTotal: number;
  progress: TurnProgress;
  /** The turn's usual per-round output ceiling (shorter for Free accounts on Plexo's AI). */
  maxOutputTokens?: number;
}): boolean {
  const { provider, tier, balanceTotal, progress } = params;
  const spentCredits = creditsForUsd(computeCostUsd(provider, tier, progress.spent));
  const fromText = Math.ceil(progress.nextInputChars / CHARS_PER_TOKEN);
  const fromLastRound = progress.lastRound ? progress.lastRound.inputTokens + progress.lastRound.outputTokens : 0;
  const nextRoundCredits = creditsForUsd(
    computeCostUsd(provider, tier, {
      inputTokens: Math.max(fromText, fromLastRound),
      outputTokens: progress.maxOutputTokens ?? params.maxOutputTokens ?? MAX_TOKENS.agent_chat,
    }),
  );
  return balanceTotal - spentCredits >= nextRoundCredits;
}
