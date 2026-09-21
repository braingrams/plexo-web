import Anthropic from "@anthropic-ai/sdk";
import type { ProviderCallParams, ProviderCallResult, GenerateWithToolsParams, GenerateWithToolsResult } from "./shared";

// `client.messages.create` request/response shape verified against the current
// Anthropic API reference (claude-api skill), including current model IDs in
// lib/ai/modelRegistry.ts (Haiku 4.5 / Sonnet 5 / Opus 4.8).

export async function generate({
  model,
  apiKey,
  systemPrompt,
  userPrompt,
  maxTokens,
}: ProviderCallParams): Promise<ProviderCallResult> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

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
}: GenerateWithToolsParams): Promise<GenerateWithToolsResult> {
  const client = new Anthropic({ apiKey });

  // Same prompt-caching rationale as bedrockClaude.ts: SOL's tool catalog + system prompt
  // are identical across every iteration of a turn and every turn in a conversation, so
  // caching the shared prefix (system prompt + last tool def) meaningfully cuts cost/latency
  // on a long-running BYOK conversation the same way it does for the system Bedrock path.
  const cachedTools =
    tools && tools.length > 0
      ? tools.map((tool, i) => (i === tools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" as const } } : tool))
      : undefined;

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: conversationHistory,
    ...(cachedTools ? { tools: cachedTools } : {}),
  });

  if (onTextDelta) {
    stream.on("text", (textDelta) => onTextDelta(textDelta));
  }

  const finalMessage = await stream.finalMessage();

  return {
    content: finalMessage.content,
    stopReason: finalMessage.stop_reason ?? "end_turn",
    usage: {
      inputTokens: finalMessage.usage?.input_tokens ?? 0,
      outputTokens: finalMessage.usage?.output_tokens ?? 0,
    },
  };
}
