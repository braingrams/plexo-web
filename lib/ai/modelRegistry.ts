import type { AiProvider, ConcreteTier } from "./types";

/**
 * Tier -> concrete model id per provider. Kept in one place since providers
 * rename/retire models frequently — update only here.
 *
 * - anthropic_claude: verified against the claude-api skill's current model table.
 * - google_gemini: verified against the installed @google/genai SDK's own type
 *   definitions (the `Model` union in dist/genai.d.ts includes these exact preview
 *   IDs for the current Gemini 3 generation — Google hasn't shipped non-preview
 *   3.x IDs yet as of this writing).
 * - openai: the installed `openai` package's bundled `ChatModel` type list predates
 *   GPT-5 entirely, so these came from OpenAI's current pricing page instead —
 *   lowest-confidence of the three; smoke-test before relying on them.
 */
export const MODEL_REGISTRY: Record<AiProvider, Record<ConcreteTier, string>> = {
  openai: {
    BASIC: "gpt-5.4-nano",
    MEDIUM: "gpt-5.6-terra",
    HIGH: "gpt-5.6-sol",
  },
  anthropic_claude: {
    BASIC: "claude-haiku-4-5",
    MEDIUM: "claude-sonnet-5",
    HIGH: "claude-opus-4-8",
  },
  google_gemini: {
    BASIC: "gemini-3.1-flash-lite-preview",
    MEDIUM: "gemini-3-flash-preview",
    HIGH: "gemini-3.1-pro-preview",
  },
};

export function resolveModel(provider: AiProvider, tier: ConcreteTier): string {
  const providerTable = MODEL_REGISTRY[provider];
  if (!providerTable) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  return providerTable[tier];
}
