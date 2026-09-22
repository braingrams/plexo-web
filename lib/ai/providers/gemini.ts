import { GoogleGenAI } from "@google/genai";
import type {
  ProviderCallParams,
  ProviderCallResult,
  GenerateWithToolsParams,
  GenerateWithToolsResult,
} from "./shared";
import { toGeminiTools } from "@/lib/ai/solToolSchema";

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
  attachments,
}: ProviderCallParams): Promise<ProviderCallResult> {
  const client = new GoogleGenAI({ apiKey });

  const input: any = [
    {
      type: "user_input",
      content: [
        ...(attachments && attachments.length > 0
          ? attachments.map((attachment) => ({
              type: "document",
              data: attachment.data,
              mime_type: attachment.mediaType,
            }))
          : []),
        { type: "text", text: userPrompt },
      ],
    },
  ];

  const interaction = await client.interactions.create({
    model,
    input,
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
    .filter(
      (
        step,
      ): step is {
        type: "model_output";
        content?: Array<{ type: string; text: string }>;
      } =>
        typeof step === "object" &&
        step !== null &&
        (step as { type?: unknown }).type === "model_output",
    )
    .flatMap((step) => step.content ?? [])
    .filter(
      (item): item is { type: "text"; text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
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

// ---------------------------------------------------------------------------------------
// Multi-turn tool-use generation for SOL's agent loop, for BYOK accounts configured with
// `aiProvider: "google_gemini"`. Like openai.ts, this translates SOL's Anthropic-shaped
// history to/from Gemini's own wire format at this module's edges — see providers/shared.ts.
//
// The Interactions API models a conversation as an ordered `Array<Step>` (verified against
// the installed SDK's own type definitions: UserInputStep/ModelOutputStep/FunctionCallStep/
// FunctionResultStep, each tagged by its own `type`), NOT a stateless list of role-tagged
// turns the way Anthropic/OpenAI do — but critically it also supports resending the FULL
// step history on every call (rather than requiring `previous_interaction_id` continuation
// against Google's own server-side conversation state), which is what lets this stay a
// stateless per-call translation exactly like solAgent.ts already assumes, instead of
// requiring a second, Gemini-specific persistence scheme.
//
// Deliberately NON-streaming (stream: false), unlike bedrockClaude.ts/anthropic.ts/
// openai.ts: the Interactions API's incremental SSE delta shape for text/function-call
// arguments isn't yet verified against this exact installed SDK version the way the
// non-streaming response shape below is (see generate()'s own top-of-file caveat about this
// API surface being new enough to risk docs/implementation drift) — text still reaches
// `onTextDelta` correctly, just as one full chunk at the end of the call rather than
// token-by-token. Revisit once the streaming step-delta shape has been confirmed against
// real traffic.

type GeminiContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source:
        | { type: "url"; url: string }
        | { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source:
        | { type: "url"; url: string }
        | { type: "base64"; media_type: string; data: string };
    }
  | { type: "tool_use"; id: string; name: string; input: any }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    };

function blocksToGeminiContent(blocks: GeminiContentBlock[]): any[] {
  const content: any[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      content.push(
        block.source.type === "url"
          ? { type: "image", uri: block.source.url }
          : {
              type: "image",
              data: block.source.data,
              mime_type: block.source.media_type,
            },
      );
    } else if (block.type === "document") {
      content.push(
        block.source.type === "url"
          ? { type: "document", uri: block.source.url }
          : {
              type: "document",
              data: block.source.data,
              mime_type: block.source.media_type,
            },
      );
    }
  }
  return content;
}

function toGeminiSteps(
  conversationHistory: GenerateWithToolsParams["conversationHistory"],
): any[] {
  const steps: any[] = [];
  for (const entry of conversationHistory) {
    const blocks: GeminiContentBlock[] = Array.isArray(entry.content)
      ? entry.content
      : [{ type: "text", text: String(entry.content) }];

    if (entry.role === "user") {
      if (blocks.length > 0 && blocks[0].type === "tool_result") {
        for (const block of blocks) {
          if (block.type !== "tool_result") continue;
          steps.push({
            type: "function_result",
            call_id: block.tool_use_id,
            result:
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? null),
            is_error: block.is_error,
          });
        }
      } else {
        steps.push({
          type: "user_input",
          content: blocksToGeminiContent(blocks),
        });
      }
      continue;
    }

    // assistant
    const textBlocks = blocks.filter(
      (b): b is Extract<GeminiContentBlock, { type: "text" }> =>
        b.type === "text",
    );
    const toolUseBlocks = blocks.filter(
      (b): b is Extract<GeminiContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    if (textBlocks.length > 0) {
      steps.push({
        type: "model_output",
        content: [
          { type: "text", text: textBlocks.map((b) => b.text).join("") },
        ],
      });
    }
    for (const block of toolUseBlocks) {
      steps.push({
        type: "function_call",
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
      });
    }
  }
  return steps;
}

function mapInteractionStatus(status: string | undefined): string {
  if (status === "requires_action") return "tool_use";
  if (status === "incomplete") return "max_tokens";
  return "end_turn";
}

export async function generateWithTools({
  model,
  apiKey,
  systemPrompt,
  conversationHistory,
  tools,
  maxTokens,
  onTextDelta,
}: GenerateWithToolsParams): Promise<GenerateWithToolsResult> {
  const client = new GoogleGenAI({ apiKey });

  const interaction = await client.interactions.create({
    model,
    input: toGeminiSteps(conversationHistory),
    system_instruction: systemPrompt,
    ...(tools && tools.length > 0 ? { tools: toGeminiTools(tools) } : {}),
    generation_config: { max_output_tokens: maxTokens },
    stream: false,
  });

  const content: any[] = [];
  for (const step of (interaction.steps ?? []) as any[]) {
    if (step?.type === "model_output") {
      const text = (
        (step.content ?? []) as Array<{ type: string; text?: string }>
      )
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      if (text) content.push({ type: "text", text });
    } else if (step?.type === "function_call") {
      content.push({
        type: "tool_use",
        id: step.id,
        name: step.name,
        input: step.arguments ?? {},
      });
    }
  }

  if (onTextDelta) {
    const fullText = content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (fullText) onTextDelta(fullText);
  }

  return {
    content,
    stopReason: mapInteractionStatus(
      (interaction as { status?: string }).status,
    ),
    usage: {
      inputTokens: interaction.usage?.total_input_tokens ?? 0,
      outputTokens: interaction.usage?.total_output_tokens ?? 0,
    },
  };
}
