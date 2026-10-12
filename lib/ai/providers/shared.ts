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
  /** Called with each piece of text as the model writes it (providers that stream; others just return the result). */
  onTextDelta?: (delta: string) => void;
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
  /** Called while the model writes a tool call's input — which for a whole page of HTML can
   * take a minute or two, with no text streaming meanwhile — so the person sees progress. */
  onToolInputProgress?: (progress: { id: string; name: string; characters: number }) => void;
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

/** A tool result as plain text, for providers whose tool results are text-only (OpenAI,
 * Gemini). Content arrays (e.g. a screenshot tool's text + image) keep their text; images
 * become a short note instead of a wall of base64. */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === "text" ? String(b.text ?? "") : b?.type === "image" ? "[Image omitted — this AI provider can't view images in tool results.]" : JSON.stringify(b)))
      .join("\n");
  }
  return JSON.stringify(content ?? null);
}

/**
 * Prompt-caching breakpoints on the conversation itself. Inside one agent turn (and across
 * turns minutes apart) the replayed history is append-only, so marking the end of the latest
 * message — plus the end of the previous user-side message, so a long round can't fall outside
 * the cache's look-back window — lets every call after the first read the old part from the
 * cache at a tenth of the price and write only what's new. Returns copies; nothing stored changes.
 */
export function withHistoryCacheBreakpoints<T extends { role: "user" | "assistant"; content: any }>(history: T[]): T[] {
  if (history.length === 0) return history;
  const out = history.slice();
  const mark = (index: number) => {
    const entry = out[index];
    const blocks: any[] = Array.isArray(entry.content) ? entry.content.slice() : [{ type: "text", text: String(entry.content ?? "") }];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      // Empty text and thinking blocks can't carry a breakpoint.
      if (!block || block.type === "thinking" || block.type === "redacted_thinking" || (block.type === "text" && !String(block.text ?? "").trim())) continue;
      blocks[i] = { ...block, cache_control: { type: "ephemeral" } };
      out[index] = { ...entry, content: blocks };
      return;
    }
  };
  mark(out.length - 1);
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i].role === "user") {
      mark(i);
      break;
    }
  }
  return out;
}

/**
 * What a model call's input really cost, in ordinary input tokens: cached reads are billed at
 * 10% and cache writes at 125% of the normal rate, and the API reports them separately from
 * `input_tokens`. Counting only `input_tokens` would hide most of the real input.
 */
export function billableInputTokens(usage: { input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined): number {
  if (!usage) return 0;
  return Math.round((usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1);
}
