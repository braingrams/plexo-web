import OpenAI from "openai";
import type { ProviderCallParams, ProviderCallResult } from "./shared";

/**
 * `max_completion_tokens` and `response_format: { type: "json_object" }` were
 * verified directly against the installed `openai` package's own type definitions
 * (node_modules/openai/resources/chat/completions/completions.d.ts) — `max_tokens`
 * is explicitly marked deprecated there in favor of `max_completion_tokens`.
 */

export async function generate({
  model,
  apiKey,
  systemPrompt,
  userPrompt,
  maxTokens,
}: ProviderCallParams): Promise<ProviderCallResult> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content ?? "";

  return {
    text,
    usage: {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    },
    truncated: response.choices[0]?.finish_reason === "length",
  };
}
