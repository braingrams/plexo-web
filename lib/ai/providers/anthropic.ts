import Anthropic from "@anthropic-ai/sdk";
import type { ProviderCallParams, ProviderCallResult } from "./shared";

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
