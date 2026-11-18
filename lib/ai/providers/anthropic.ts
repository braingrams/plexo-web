import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderCallParams,
  ProviderCallResult,
  GenerateWithToolsParams,
  GenerateWithToolsResult,
} from "./shared";
import { withHistoryCacheBreakpoints, billableInputTokens } from "./shared";

// `client.messages.create` request/response shape verified against the current
// Anthropic API reference (claude-api skill), including current model IDs in
// lib/ai/modelRegistry.ts (Haiku 4.5 / Sonnet 5 / Opus 4.8).

export async function generate({
  model,
  apiKey,
  systemPrompt,
  userPrompt,
  maxTokens,
  attachments,
  onTextDelta,
}: ProviderCallParams): Promise<ProviderCallResult> {
  const client = new Anthropic({ apiKey });

  // Pictures go in as image blocks; everything else (a PDF) as a document block.
  const content: any[] = (attachments ?? []).map((attachment) => ({
    type: attachment.mediaType.startsWith("image/") ? "image" : "document",
    source: {
      type: "base64",
      media_type: attachment.mediaType as any,
      data: attachment.data,
    },
  }));
  content.push({ type: "text", text: userPrompt });

  // Streamed, then collected into one message: the SDK refuses a non-streaming request
  // whose max_tokens could run past 10 minutes (any large page — generate_raw_html asks
  // for up to 32000 tokens, 64000 on the truncation retry). Same result as create().
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  });
  // Lets the caller show the page being written (lib/ai/generateRequest.ts streams it to the browser).
  if (onTextDelta) stream.on("text", onTextDelta);
  const response = await stream.finalMessage();

  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  return {
    text,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
    truncated: response.stop_reason === "max_tokens",
  };
}

/**
 * Multi-turn generation with tool use + streaming, for SOL's agent loop when a BYOK
 * account's key is `anthropic_claude` — identical request/response shape to
 * bedrockClaude.ts's `generateWithTools` (same Anthropic Messages API), just a directly
 * authenticated `Anthropic` client instead of `AnthropicBedrock`'s IAM auth. See
 * providers/shared.ts for why this returns the same Anthropic-shaped content blocks
 * regardless of provider.
 */
export async function generateWithTools({
  model,
  apiKey,
  systemPrompt,
  conversationHistory,
  tools,
  maxTokens,
  onTextDelta,
  onToolInputProgress,
}: GenerateWithToolsParams): Promise<GenerateWithToolsResult> {
  const client = new Anthropic({ apiKey });

  // Same prompt-caching rationale as bedrockClaude.ts: SOL's tool catalog + system prompt
  // are identical across every iteration of a turn and every turn in a conversation, so
  // caching the shared prefix (system prompt + last tool def) meaningfully cuts cost/latency
  // on a long-running BYOK conversation the same way it does for the system Bedrock path.
  const cachedTools =
    tools && tools.length > 0
      ? tools.map((tool, i) =>
          i === tools.length - 1
            ? { ...tool, cache_control: { type: "ephemeral" as const } }
            : tool,
        )
      : undefined;

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: withHistoryCacheBreakpoints(conversationHistory),
    ...(cachedTools ? { tools: cachedTools } : {}),
  });

  if (onTextDelta) {
    stream.on("text", (textDelta) => onTextDelta(textDelta));
  }
  if (onToolInputProgress) {
    // A tool call's input arrives as JSON fragments after its block starts; report its size.
    const writing = new Map<number, { id: string; name: string; characters: number }>();
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        const call = { id: event.content_block.id, name: event.content_block.name, characters: 0 };
        writing.set(event.index, call);
        onToolInputProgress({ ...call });
      } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
        const call = writing.get(event.index);
        if (call) {
          call.characters += event.delta.partial_json.length;
          onToolInputProgress({ ...call });
        }
      }
    });
  }

  const finalMessage = await stream.finalMessage();

  return {
    content: finalMessage.content,
    stopReason: finalMessage.stop_reason ?? "end_turn",
    usage: {
      inputTokens: billableInputTokens(finalMessage.usage),
      outputTokens: finalMessage.usage?.output_tokens ?? 0,
    },
  };
}
