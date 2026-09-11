import type { AiProvider, ConcreteTier, GenerateOutcome } from "@/lib/ai/types";

interface ModelRate {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

/**
 * Real provider $/token cost per model, mirroring `lib/ai/modelRegistry.ts`'s
 * provider->tier shape so the two stay in lockstep as models change.
 *
 * - anthropic_claude: current published pricing for Haiku 4.5 / Sonnet 5 / Opus 4.8.
 * - openai / google_gemini: placeholders proportioned against the anthropic_claude
 *   row (same lowest-confidence caveat Phase 1 gave these providers' model ids) —
 *   verify against each provider's real billing page before relying on this for
 *   actual invoicing.
 * - bedrock_claude: mirrors the anthropic_claude row above as the working estimate,
 *   for Claude Haiku 4.5 / Sonnet 5 / Opus 5 specifically (matching the real,
 *   AWS-account-verified model IDs in modelRegistry.ts — see that file's own comment).
 *   This is a deliberate choice, not laziness: Anthropic's newer Bedrock models are
 *   "third-party models offered and billed through AWS Marketplace" per their own
 *   Bedrock model-card pages, and — confirmed by direct investigation against the real
 *   Plexo AWS account (`aws pricing get-products`/`get-attribute-values
 *   --service-code AmazonBedrock`) — NONE of Claude Haiku 4.5 / Sonnet 5 / Opus 5 have
 *   any SKU in the public AWS Price List API at all (the API only has legacy Claude
 *   2.x/3.x entries for Anthropic; OpenAI and xAI's current models DO appear there,
 *   so this a real, Anthropic/Marketplace-specific gap, not a query mistake). The
 *   Bedrock console's own Model catalog page shows the live per-model price and isn't
 *   scrapable from this environment — **before this earns real revenue, open the
 *   Bedrock console for Claude Haiku 4.5 / Sonnet 5 / Opus 5 in us-east-2 and confirm
 *   these three rates against what's actually shown there**, then update this row —
 *   nothing else needs to change, `computeCostUsd`/`chargeUsage` already read from here.
 */
export const MODEL_PRICING: Record<AiProvider, Record<ConcreteTier, ModelRate>> = {
  anthropic_claude: {
    BASIC: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
    MEDIUM: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    HIGH: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  },
  openai: {
    BASIC: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    MEDIUM: { inputPerMillion: 1.25, outputPerMillion: 5.0 },
    HIGH: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  },
  google_gemini: {
    BASIC: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    MEDIUM: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    HIGH: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  },
  bedrock_claude: {
    BASIC: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
    MEDIUM: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    HIGH: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  },
};

// Google's published Imagen 4 per-image price at the time this was written — same
// "verify against the provider's real billing page before relying on this for actual
// invoicing" caveat as MODEL_PRICING above. Flat per-image cost, not token-derived, since
// image generation isn't priced per input/output token the way text models are.
export const IMAGE_GENERATION_USD_COST = 0.04;

export function imageGenerationCredits(): number {
  return creditsForUsd(IMAGE_GENERATION_USD_COST);
}

/** USD value of a single credit — how the configurable credit<->dollar ratio is expressed. */
function creditUsdValue(): number {
  const raw = process.env.CREDIT_USD_VALUE;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.001; // default: 1000 credits = $1
}

export function computeCostUsd(
  provider: AiProvider,
  tier: ConcreteTier,
  usage: GenerateOutcome["usage"],
): number {
  const rate = MODEL_PRICING[provider][tier];
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return (inputTokens / 1_000_000) * rate.inputPerMillion + (outputTokens / 1_000_000) * rate.outputPerMillion;
}

export function creditsForUsd(usd: number): number {
  return Math.ceil(usd / creditUsdValue());
}

export function usdForCredits(credits: number): number {
  return credits * creditUsdValue();
}
