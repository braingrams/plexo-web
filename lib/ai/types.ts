export type AiActionMode = "edit_element" | "edit_layout" | "generate_layout";

export type AiProvider = "openai" | "anthropic_claude" | "google_gemini";

export type ConcreteTier = "BASIC" | "MEDIUM" | "HIGH";

export interface GenerateOutcome {
  summary: string;
  result: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}
