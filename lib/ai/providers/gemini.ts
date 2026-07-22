import { GoogleGenAI } from "@google/genai";
import type { ProviderCallParams, ProviderCallResult } from "./shared";

/**
 * Uses the Gemini Interactions API (`client.interactions.create`) — the current
 * GA surface Google's docs recommend "for access to all the latest features",
 * superseding the older `client.models.generateContent`. Field names (snake_case:
 * system_instruction, response_mime_type, generation_config.max_output_tokens) were
 * verified directly against the installed @google/genai SDK's own type definitions
 * (node_modules/@google/genai/dist/genai.d.ts), not just docs, since the docs API
 * surface is new enough to risk drift between what's written and what's shipped.
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
    response_mime_type: "application/json",
    generation_config: {
      max_output_tokens: maxTokens,
    },
    stream: false,
  });

  // The SDK's internal "Content" union for interaction outputs isn't cleanly
  // exported under a matching public type name, so duck-type the one shape we
  // care about (text parts) rather than fight the SDK's internal aliasing.
  const text = (interaction.outputs ?? [])
    .filter((item): item is { type: "text"; text: string } => (
      typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text"
    ))
    .map((item) => item.text)
    .join("");

  return {
    text,
    usage: {
      inputTokens: interaction.usage?.total_input_tokens,
      outputTokens: interaction.usage?.total_output_tokens,
    },
  };
}
