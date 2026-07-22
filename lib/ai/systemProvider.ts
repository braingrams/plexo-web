import type { AiProvider } from "./types";

const SYSTEM_KEY_ENV_BY_PROVIDER: Record<AiProvider, string> = {
  anthropic_claude: "SYSTEM_AI_KEY_ANTHROPIC_CLAUDE",
  openai: "SYSTEM_AI_KEY_OPENAI",
  google_gemini: "SYSTEM_AI_KEY_GOOGLE_GEMINI",
};

function isAiProvider(value: string): value is AiProvider {
  return value in SYSTEM_KEY_ENV_BY_PROVIDER;
}

export interface SystemProviderConfig {
  provider: AiProvider;
  apiKey: string;
}

/**
 * Resolves the single active "system AI" provider (used for accounts without
 * a BYOK key) from env config. Switching providers is a one-line env change —
 * `SYSTEM_AI_PROVIDER` — with no code or schema change, as long as the matching
 * `SYSTEM_AI_KEY_*` var is already provisioned.
 */
export function resolveSystemProvider(): SystemProviderConfig {
  const provider = process.env.SYSTEM_AI_PROVIDER;
  if (!provider || !isAiProvider(provider)) {
    throw new Error(
      `SYSTEM_AI_PROVIDER is not configured or invalid (got: ${provider ?? "unset"}). Expected one of: ${Object.keys(SYSTEM_KEY_ENV_BY_PROVIDER).join(", ")}.`,
    );
  }

  const envVar = SYSTEM_KEY_ENV_BY_PROVIDER[provider];
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`System AI is configured to use "${provider}" but ${envVar} is not set.`);
  }

  return { provider, apiKey };
}
