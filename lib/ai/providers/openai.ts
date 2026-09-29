import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions/completions";
import type {
  ProviderCallParams,
  ProviderCallResult,
  GenerateWithToolsParams,
  GenerateWithToolsResult,
} from "./shared";
import { toOpenAiTools } from "@/lib/ai/solToolSchema";

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
  attachments,
}: ProviderCallParams): Promise<ProviderCallResult> {
  const client = new OpenAI({ apiKey });

  // chat.completions has no inline-document content part (that needs the separate
  // Files/Assistants API) — degrade each attachment to a text note naming it so the model
  // at least knows a file was attached, matching generateWithTools' document handling below.
  const userContent =
    attachments && attachments.length > 0
      ? `${attachments.map((attachment) => `[Attached file: ${attachment.name ?? attachment.mediaType}]`).join("\n")}\n\n${userPrompt}`
      : userPrompt;

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
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

// ---------------------------------------------------------------------------------------
// Multi-turn tool-use generation for SOL's agent loop, for BYOK accounts configured with
// `aiProvider: "openai"`. The wire format OpenAI's chat.completions API speaks (flat
// message list, `tool_calls`/`role:"tool"`) is genuinely different from the Anthropic-shaped
// content-block format solAgent.ts's history/persistence assumes — see providers/shared.ts's
// top-of-file comment. Everything below exists to translate at this module's edges so
// solAgent.ts never has to know the difference.

/** An Anthropic-shaped `image`/`document` content block, as solAgent.ts's history stores
 * them (see solChatHandler.ts's buildUserMessageContent). */
type AnthropicContentBlock =
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

function anthropicContentToOpenAiParts(
  blocks: AnthropicContentBlock[],
): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      const url =
        block.source.type === "url"
          ? block.source.url
          : `data:${block.source.media_type};base64,${block.source.data}`;
      parts.push({ type: "image_url", image_url: { url } });
    } else if (block.type === "document") {
      // OpenAI's chat.completions API has no equivalent inline-document content part (that
      // would need the separate Files/Assistants API) — degrade to a text note naming the
      // attachment rather than silently dropping it, so BYOK-OpenAI accounts at least see
      // that something was attached even though its contents aren't analyzed.
      const url =
        block.source.type === "url" ? block.source.url : "(inline document)";
      parts.push({ type: "text", text: `[Attached document: ${url}]` });
    }
  }
  return parts;
}

/** Converts SOL's Anthropic-shaped conversation history + system prompt into OpenAI's flat
 * `ChatCompletionMessageParam[]`. A history entry's content is always homogeneous in
 * practice (see solAgent.ts) — either the user's own text/image/document blocks, or (when
 * the first block is a `tool_result`) a pure tool-results message — so branching on the
 * first block's type is enough to tell the two apart. */
function toOpenAiMessages(
  systemPrompt: string,
  conversationHistory: GenerateWithToolsParams["conversationHistory"],
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const entry of conversationHistory) {
    const blocks: AnthropicContentBlock[] = Array.isArray(entry.content)
      ? entry.content
      : [{ type: "text", text: String(entry.content) }];

    if (entry.role === "user") {
      if (blocks.length > 0 && blocks[0].type === "tool_result") {
        for (const block of blocks) {
          if (block.type !== "tool_result") continue;
          const content =
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? null);
          messages.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content,
          });
        }
      } else {
        messages.push({
          role: "user",
          content: anthropicContentToOpenAiParts(blocks),
        });
      }
      continue;
    }

    // assistant
    const textBlocks = blocks.filter(
      (b): b is Extract<AnthropicContentBlock, { type: "text" }> =>
        b.type === "text",
    );
    const toolUseBlocks = blocks.filter(
      (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    const text = textBlocks.map((b) => b.text).join("");
    messages.push({
      role: "assistant",
      content: text.length > 0 ? text : null,
      ...(toolUseBlocks.length > 0
        ? {
            tool_calls: toolUseBlocks.map((b) => ({
              id: b.id,
              type: "function" as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input ?? {}),
              },
            })),
          }
        : {}),
    });
  }

  return messages;
}

function mapFinishReason(reason: string | null | undefined): string {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
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
  const client = new OpenAI({ apiKey });

  const stream = client.beta.chat.completions.stream({
    model,
    max_completion_tokens: maxTokens,
    messages: toOpenAiMessages(systemPrompt, conversationHistory),
    ...(tools && tools.length > 0 ? { tools: toOpenAiTools(tools) } : {}),
  });

  if (onTextDelta) {
    stream.on("content", (delta) => onTextDelta(delta));
  }

  const completion = await stream.finalChatCompletion();
  const message = completion.choices[0]?.message;

  const content: any[] = [];
  if (message?.content) content.push({ type: "text", text: message.content });
  for (const toolCall of message?.tool_calls ?? []) {
    let input: any = {};
    try {
      input = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input,
    });
  }

  return {
    content,
    stopReason: mapFinishReason(completion.choices[0]?.finish_reason),
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}
