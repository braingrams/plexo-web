import { estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import type { ConcreteTier } from "@/lib/ai/types";

// SOL's agent loop (lib/ai/solAgent.ts) can call the model multiple times in a single
// user-visible "turn" — once per round of tool use — before it produces a final answer.
// MAX_TOOL_ITERATIONS bounds how many of those model calls one turn may make; runAgentTurn
// throws AgentIterationLimitError if it's exhausted without a final (non-tool_use) answer.
export const MAX_TOOL_ITERATIONS = 8;

/**
 * Worst-case credit cost of one full agent turn, used as a pre-flight balance gate before
 * starting the loop (and again, via budgetGuard, before each iteration inside it). Each
 * iteration is priced as its own worst-case bedrock_claude/"agent_chat" call (conservative
 * input-char estimate, MAX_TOKENS.agent_chat as the output ceiling — see
 * estimateWorstCaseCost in lib/db/ledgerOperations.ts), multiplied by the max number of
 * iterations a turn could take. This is deliberately pessimistic — chargeUsage bills the
 * real, usually far lower, per-call amount after the fact — the same "estimate high,
 * charge actual" pattern generateBuilderAction/chargeUsage already use for a single call.
 */
export function estimateWorstCaseAgentTurnCost(tier: ConcreteTier, approxInputChars: number): number {
  const perCallEstimate = estimateWorstCaseCost("bedrock_claude", tier, "agent_chat", approxInputChars);
  return perCallEstimate * MAX_TOOL_ITERATIONS;
}
