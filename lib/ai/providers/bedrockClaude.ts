import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type { ProviderCallParams, ProviderCallResult } from "./shared";

// Amazon Bedrock's Anthropic Messages API is wire-compatible with the direct
// Anthropic API — `AnthropicBedrock` (from `@anthropic-ai/bedrock-sdk`) extends the
// same `BaseAnthropic` client class the plain `@anthropic-ai/sdk` `Anthropic` client
// does (confirmed against the installed package's `src/client.ts`), so
// `client.messages.create` / `client.messages.stream`, request/response shapes, and
// `usage.input_tokens`/`output_tokens` all match lib/ai/providers/anthropic.ts exactly.
// Model IDs come from lib/ai/modelRegistry.ts's `bedrock_claude` row (env-overridable —
// see that file's placeholder-model-id caveat).
//
// Auth/region: Bedrock is authenticated via AWS credentials (IAM role, or
// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN env vars, resolved by the
// AWS SDK's own default credential provider chain), not a bearer API key — so unlike
// the other providers' `apiKey` param, there is no per-account/BYOK key here. This is
// Plexo's own hosted System-tier AI agent (SOL) traffic, billed to Plexo's AWS account.

function buildClient(): AnthropicBedrock {
  return new AnthropicBedrock({ awsRegion: process.env.AWS_REGION });
}

/**
 * Single-turn, non-streaming, no-tools generation — mirrors anthropic.ts's `generate`
 * parameter/return shape exactly (`apiKey` is accepted for shape parity with the other
 * providers' `ProviderCallParams` but is unused: see the auth note above).
 */
export async function generate({ model, systemPrompt, userPrompt, maxTokens }: ProviderCallParams): Promise<ProviderCallResult> {
  const client = buildClient();

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

export interface BedrockToolDef {
  name: string;
  description: string;
  input_schema: any;
}

export interface BedrockGenerateWithToolsParams {
  model: string;
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: any }>;
  tools?: BedrockToolDef[];
  maxTokens: number;
  onTextDelta?: (delta: string) => void;
}

export interface BedrockGenerateWithToolsResult {
  /** Raw Anthropic-shaped content blocks (may include `tool_use` blocks). */
  content: any[];
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Multi-turn generation with tool use + streaming, for SOL's agent loop. Streams the
 * response, forwarding incremental assistant text to `onTextDelta` as it arrives, and
 * returns the fully-assembled message (text + any `tool_use` blocks) once the stream ends.
 */
export async function generateWithTools({
  model,
  systemPrompt,
  conversationHistory,
  tools,
  maxTokens,
  onTextDelta,
}: BedrockGenerateWithToolsParams): Promise<BedrockGenerateWithToolsResult> {
  const client = buildClient();

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: conversationHistory,
    ...(tools && tools.length > 0 ? { tools } : {}),
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
