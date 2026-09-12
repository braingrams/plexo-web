export type AiActionMode =
  | "edit_element"
  | "edit_layout"
  | "generate_layout"
  | "edit_raw_html"
  | "generate_blog_post"
  // SOL, the AI agent chat feature (lib/ai/solAgent.ts) — one turn of a multi-turn,
  // tool-using conversation. See MAX_TOKENS below (lib/ai/generate.ts) for its output
  // ceiling and lib/credits/agentTurnEstimate.ts for how a whole agent turn (which may
  // call the model up to MAX_TOOL_ITERATIONS times) is pre-flight estimated.
  | "agent_chat";

// `anthropic_claude` = direct Anthropic API (BYOK / Host-Managed AI modes, via
// lib/ai/providers/anthropic.ts). `bedrock_claude` = Amazon Bedrock (Plexo's own
// hosted System-tier AI agent traffic, via lib/ai/providers/bedrockClaude.ts) — a
// distinct, separately-addressable provider even though both ultimately call Claude.
export type AiProvider = "openai" | "anthropic_claude" | "google_gemini" | "bedrock_claude";

export type ConcreteTier = "BASIC" | "MEDIUM" | "HIGH";

export interface GenerateOutcome {
  summary: string;
  result: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}
