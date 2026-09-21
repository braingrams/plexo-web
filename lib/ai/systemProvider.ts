import type { AiProvider } from "./types";

// `bedrock_claude` is a normal, first-class member of this selection: the pre-existing
// page-builder AI feature's SYSTEM-tier calls (edit-in-place, layout generation, blog
// post generation — served by app/api/v1/ai/generate/route.ts) now also route to Amazon
// Bedrock when `SYSTEM_AI_PROVIDER=bedrock_claude`, same as any other system provider.
// It has no entry in SYSTEM_KEY_ENV_BY_PROVIDER below because Bedrock doesn't use one —
// see the apiKey note on SystemProviderConfig.
const SYSTEM_KEY_ENV_BY_PROVIDER: Record<Exclude<AiProvider, "bedrock_claude">, string> = {
  anthropic_claude: "SYSTEM_AI_KEY_ANTHROPIC_CLAUDE",
  openai: "SYSTEM_AI_KEY_OPENAI",
  google_gemini: "SYSTEM_AI_KEY_GOOGLE_GEMINI",
};

function isAiProvider(value: string): value is AiProvider {
  return value === "bedrock_claude" || value in SYSTEM_KEY_ENV_BY_PROVIDER;
}

export interface SystemProviderConfig {
  provider: AiProvider;
  /**
   * For every provider except `bedrock_claude`, the decrypted `SYSTEM_AI_KEY_*` value
   * that provider's SDK client is constructed with. `bedrock_claude` authenticates via
   * AWS IAM (the Lambda's execution role/region, resolved by the AWS SDK's own default
   * credential provider chain inside lib/ai/providers/bedrockClaude.ts) rather than a
   * bearer API key, so for that provider this field is a meaningless, unused placeholder
   * ("") — there is no `SYSTEM_AI_KEY_BEDROCK_CLAUDE` env var to read, and callers must
   * not treat an empty string here as a misconfiguration for this one provider.
   */
  apiKey: string;
}

/**
 * Resolves the single active "system AI" provider (used for accounts without
 * a BYOK key) from env config. Switching providers is a one-line env change —
 * `SYSTEM_AI_PROVIDER` — with no code or schema change, as long as the matching
 * `SYSTEM_AI_KEY_*` var is already provisioned (not applicable for `bedrock_claude`,
 * which needs no such var — see SystemProviderConfig.apiKey above).
 */
export function resolveSystemProvider(): SystemProviderConfig {
  const provider = process.env.SYSTEM_AI_PROVIDER;
  if (!provider || !isAiProvider(provider)) {
    const validValues = [...Object.keys(SYSTEM_KEY_ENV_BY_PROVIDER), "bedrock_claude"];
    throw new Error(
      `SYSTEM_AI_PROVIDER is not configured or invalid (got: ${provider ?? "unset"}). Expected one of: ${validValues.join(", ")}.`,
    );
  }

  if (provider === "bedrock_claude") {
    return { provider, apiKey: "" };
  }

  const envVar = SYSTEM_KEY_ENV_BY_PROVIDER[provider];
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`System AI is configured to use "${provider}" but ${envVar} is not set.`);
  }

  return { provider, apiKey };
}
