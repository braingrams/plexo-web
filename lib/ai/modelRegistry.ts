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
 * - bedrock_claude: verified against AWS's own Bedrock model-card docs for Claude
 *   Haiku 4.5 / Sonnet 5 / Opus 5, specifically for a deploy in **us-east-1** (the
 *   real plexo-web deploy region — confirmed directly against the account's actual
 *   DynamoDB tables, all of which live in us-east-1, not us-east-2 as an earlier pass
 *   assumed and had to correct). None of these three models supports direct in-Region
 *   invocation on the bedrock-runtime endpoint — only Geo/Global cross-region
 *   inference profiles — so the values below are the "US geo" inference-profile IDs
 *   (`us.anthropic....`, which keep data within US/Canada regions), not bare
 *   foundation-model IDs. us-east-1 is a valid US-geo source region for all three
 *   models, and model access is confirmed AUTHORIZED for all three in this exact
 *   account/region (`aws bedrock get-foundation-model-availability`) as of this
 *   writing. This is still an account-level dependency, not a
 *   pure code fact: Bedrock requires each model to be explicitly granted "model
 *   access" per account/region in the Bedrock console (a EULA click-through) before
 *   these IDs will actually invoke successfully — a 100% code-correct ID still
 *   throws AccessDeniedException until that's done for this AWS account. Still
 *   overridable via `BEDROCK_MODEL_ID_*` env vars if the deploy region ever changes
 *   (a different region may need a different geo prefix, or "global.").
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
  bedrock_claude: {
    BASIC: process.env.BEDROCK_MODEL_ID_BASIC ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    MEDIUM: process.env.BEDROCK_MODEL_ID_MEDIUM ?? "us.anthropic.claude-sonnet-5",
    HIGH: process.env.BEDROCK_MODEL_ID_HIGH ?? "us.anthropic.claude-opus-5",
  },
};

export function resolveModel(provider: AiProvider, tier: ConcreteTier): string {
  const providerTable = MODEL_REGISTRY[provider];
  if (!providerTable) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  return providerTable[tier];
}
