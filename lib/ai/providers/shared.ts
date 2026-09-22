export interface ProviderCallParams {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  /** Optional inline file attachments (e.g. a PDF catalog to read alongside the prompt),
   * base64-encoded. Providers with native multimodal document support (Anthropic, Bedrock
   * Claude, Gemini) forward these as real document/inline-data blocks; OpenAI's
   * chat.completions API has no inline-document equivalent, so it degrades to a text note. */
  attachments?: Array<{ mediaType: string; data: string; name?: string }>;
}

export interface ProviderCallResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** True when the provider stopped generating because it hit `maxTokens`, not because it
   * naturally finished — `text` is very likely a truncated, unparseable partial JSON
   * document in that case. Lets callers surface a clear "cut off" error (and retry with a
   * bigger budget) instead of a confusing JSON.parse failure. */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------------------
// Shared multi-turn tool-use contract for SOL's agent loop (lib/ai/solAgent.ts).
//
// The wire format below is Anthropic's own Messages API shape (content-block arrays,
// tool_use/tool_result blocks) — that's what's actually persisted verbatim in SolMessage
// rows and what the frontend (useSolStream.ts, ToolCallCard.tsx) already expects, so it's
// kept as the one canonical internal representation regardless of which provider actually
// serves a given turn. bedrockClaude.ts and anthropic.ts speak this natively; openai.ts and
// gemini.ts each translate to/from their own wire format at the edges of their own
// `generateWithTools`, so solAgent.ts's loop never has to know the difference.
export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: any;
}

export interface GenerateWithToolsParams {
  model: string;
  /** BYOK providers only (anthropic_claude direct, openai, google_gemini) — ignored by
   * bedrock_claude, which authenticates via IAM instead (see bedrockClaude.ts). */
  apiKey?: string;
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: any }>;
  tools?: AnthropicToolDef[];
  maxTokens: number;
  onTextDelta?: (delta: string) => void;
}

export interface GenerateWithToolsResult {
  /** Anthropic-shaped content blocks (may include `tool_use` blocks), regardless of which
   * provider produced them. */
  content: any[];
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
