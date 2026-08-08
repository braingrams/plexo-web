import { GoogleGenAI } from "@google/genai";
import type { ProviderCallParams, ProviderCallResult } from "./shared";

/**
 * Uses the Gemini Interactions API (`client.interactions.create`) — the current
 * GA surface Google's docs recommend "for access to all the latest features",
 * superseding the older `client.models.generateContent`. Field names (snake_case:
 * system_instruction, response_format, generation_config.max_output_tokens) were
 * verified directly against the installed @google/genai SDK's own type definitions
 * (node_modules/@google/genai/dist/genai.d.ts), not just docs, since the docs API
 * surface is new enough to risk drift between what's written and what's shipped.
 *
 * Google's May 2026 Interactions API schema change replaced the response's
 * `outputs` array with a `steps` array (verified against @google/genai@2.13.0's
 * genai.d.ts — `outputs` no longer appears anywhere in the response types).
 * Only steps with `type: "model_output"` carry generated content; each one's
 * `content` array holds typed parts (text/image/audio/...), of which we only
 * care about `type: "text"`. `usage.total_*_tokens` is unchanged.
 *
 * `response_mime_type` alone is deprecated AND now rejected outright — the
 * API 400s with "responseFormat must be set when responseMimeType is set"
 * once it's the only thing set. JSON mode now goes entirely through
 * `response_format: { type: "text", mime_type: "application/json" }`.
 */
export async function generate({
  model,
  apiKey,
  systemPrompt,
  userPrompt,
  maxTokens,
}: ProviderCallParams): Promise<ProviderCallResult> {
  const client = new GoogleGenAI({ apiKey });

  const interaction = await client.interactions.create({
    model,
    input: userPrompt,
    system_instruction: systemPrompt,
    response_format: { type: "text", mime_type: "application/json" },
    generation_config: {
      max_output_tokens: maxTokens,
    },
    stream: false,
  });

  // The SDK's internal step/content unions aren't cleanly exported under
  // matching public type names, so duck-type the two shapes we care about
  // (model_output steps, text content parts) rather than fight the SDK's
  // internal aliasing.
  const text = ((interaction.steps ?? []) as unknown[])
    .filter((step): step is { type: "model_output"; content?: Array<{ type: string; text: string }> } => (
      typeof step === "object" && step !== null && (step as { type?: unknown }).type === "model_output"
    ))
    .flatMap((step) => step.content ?? [])
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");

  return {
    text,
    usage: {
      inputTokens: interaction.usage?.total_input_tokens,
      outputTokens: interaction.usage?.total_output_tokens,
    },
    // "incomplete" is the Interactions API's status for a response cut short by
    // max_output_tokens (verified against @google/genai's InteractionStatus union in
    // genai.d.ts, alongside "completed"/"failed"/"cancelled"/etc.).
    truncated: interaction.status === "incomplete",
  };
}
