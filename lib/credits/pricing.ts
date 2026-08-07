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
