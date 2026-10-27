import { estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import type { ConcreteTier } from "@/lib/ai/types";

// SOL's agent loop (lib/ai/solAgent.ts) can call the model multiple times in a single
// user-visible "turn" — once per round of tool use — before it produces a final answer.
// MAX_TOOL_ITERATIONS bounds how many of those model calls one turn may make; runAgentTurn
// throws AgentIterationLimitError if it's exhausted without a final (non-tool_use) answer.
export const MAX_TOOL_ITERATIONS = 8;
// A turn that's building a React app (lib/mcp/appTools.ts) — write files, build, fix
// errors, screenshot, fix again — legitimately needs many more rounds; the per-round
// budgetGuard checks the balance before each one.
export const MAX_APP_TOOL_ITERATIONS = 40;

/**
 * The credits SOL needs before it starts a turn: one round's worst case (a bedrock_claude
 * "agent_chat" call with a conservative input estimate and MAX_TOKENS.agent_chat as the
 * output ceiling — estimateWorstCaseCost in lib/db/ledgerOperations.ts).
 *
 * Deliberately one round, not every round a turn could take: the per-round budgetGuard
 * already checks the balance before each further round and stops the turn cleanly (work so
 * far is saved) when it runs out. Gating on all rounds up front asked for more credits than
 * a whole month's allowance (8 × 32k output tokens ≈ $3.84 on MEDIUM), so most people
 * couldn't start a turn at all — see lib/credits/value.ts for the allowances.
 * chargeUsage still bills each call's real, usually far lower, cost after the fact.
 */
export function estimateWorstCaseAgentTurnCost(tier: ConcreteTier, approxInputChars: number, maxOutputTokens?: number): number {
  return estimateWorstCaseCost("bedrock_claude", tier, "agent_chat", approxInputChars, maxOutputTokens);
}
