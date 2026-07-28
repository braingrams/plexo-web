import { z } from "zod";

import { ElementJSONSchema, TemplateJSONSchema } from "@/server/sanitizer";

import { classifyPromptComplexity } from "./complexity";
import { resolveModel } from "./modelRegistry";
import * as anthropicProvider from "./providers/anthropic";
import * as geminiProvider from "./providers/gemini";
import * as openaiProvider from "./providers/openai";
import type { ProviderCallResult } from "./providers/shared";
import type { AiActionMode, AiProvider, ConcreteTier, GenerateOutcome } from "./types";

export const MAX_TOKENS: Record<AiActionMode, number> = {
  edit_element: 4000,
  edit_layout: 16000,
  generate_layout: 16000,
};

const ALLOWED_ELEMENT_TYPES = [
  "text", "button", "image", "spacer", "divider", "card", "form_container",
  "input", "textarea", "select", "heading", "paragraph", "carousel",
  "video", "social", "menu", "html", "table", "timer", "icon",
];

function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines[0].startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
    cleaned = lines.join("\n").trim();
  }
  return cleaned;
}

function buildSystemPrompt(mode: AiActionMode, templateKind: "EMAIL" | "LANDING_PAGE"): string {
  const kindLabel = templateKind === "EMAIL" ? "email template" : "landing page";

  if (mode === "edit_element") {
    return `You are Plexo's builder AI. You modify a single element's JSON (style + attributes) inside a ${kindLabel} builder according to the user's instruction.
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose:
{ "summary": "<one short sentence describing the change you made>", "result": <the full updated element JSON, keeping the same "id" and "type", only "style" and/or "attributes" changed> }`;
  }

  const modeInstruction = mode === "generate_layout"
    ? `The canvas is currently empty. Generate a complete new ${kindLabel} layout (rows, columns, elements) that fulfills the user's prompt.`
    : `Modify the given ${kindLabel} layout (add/remove/reorder rows, columns, elements; restyle sections) according to the user's instruction.`;

  return `You are Plexo's builder AI. ${modeInstruction}
Allowed element types: ${ALLOWED_ELEMENT_TYPES.join(", ")}.
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose:
{ "summary": "<one or two short sentences describing what you changed or built>", "result": <the full TemplateJSON, i.e. { "body": { "style": {...}, "rows": [...] } }> }`;
}

function resultSchemaFor(mode: AiActionMode) {
  return z.object({
    summary: z.string().max(2000),
    result: mode === "edit_element" ? ElementJSONSchema : TemplateJSONSchema,
  });
}

/** Drops heavy/irrelevant fields before sending the template to the model — token efficiency. */
function trimContext(mode: AiActionMode, context: unknown): unknown {
  if (mode === "edit_element" || context === null || typeof context !== "object") {
    return context;
  }
  const clone = JSON.parse(JSON.stringify(context));
  if (clone && typeof clone === "object" && "body" in clone) {
    delete clone.body.uploadedImages;
    delete clone.body.publishedDomain;
    delete clone.body.publishConfig;
  }
  return clone;
}

async function callProvider(
  provider: AiProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<ProviderCallResult> {
  const params = { model, apiKey, systemPrompt, userPrompt, maxTokens };
  switch (provider) {
    case "anthropic_claude":
      return anthropicProvider.generate(params);
    case "openai":
      return openaiProvider.generate(params);
    case "google_gemini":
      return geminiProvider.generate(params);
    default:
      throw new Error(`Unsupported AI provider: ${provider satisfies never}`);
  }
}

export interface GenerateParams {
  provider: AiProvider;
  /** "AUTO" | "BASIC" | "MEDIUM" | "HIGH" */
  tier: string;
  apiKey: string;
  mode: AiActionMode;
  prompt: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  context: unknown;
}

class ProviderCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export async function generateBuilderAction(params: GenerateParams): Promise<GenerateOutcome> {
  const concreteTier: ConcreteTier =
    params.tier === "AUTO"
      ? classifyPromptComplexity(params.mode, params.prompt)
      : (params.tier as ConcreteTier);

  const model = resolveModel(params.provider, concreteTier);
  const systemPrompt = buildSystemPrompt(params.mode, params.templateKind);
  const trimmedContext = trimContext(params.mode, params.context);
  const schema = resultSchemaFor(params.mode);
  const maxTokens = MAX_TOKENS[params.mode];

  const attempt = async (extraNote?: string): Promise<GenerateOutcome> => {
    const userPrompt = `${extraNote ? `${extraNote}\n\n` : ""}User instruction: ${params.prompt}\n\nCurrent JSON:\n${JSON.stringify(trimmedContext)}`;
    let text: string;
    let usage: ProviderCallResult["usage"];
    try {
      ({ text, usage } = await callProvider(
        params.provider,
        model,
        params.apiKey,
        systemPrompt,
        userPrompt,
        maxTokens,
      ));
    } catch (err) {
      // Auth/network/rate-limit failures from the provider are not the model
      // returning malformed JSON — don't relabel them as parse errors, and
      // don't burn a retry re-asking the provider to "fix its JSON".
      const reason = err instanceof Error ? err.message : "unknown error";
      throw new ProviderCallError(`AI provider request failed: ${reason}`);
    }
    const cleaned = cleanJsonString(text);
    const parsed = JSON.parse(cleaned);
    const validated = schema.parse(parsed);
    return { summary: validated.summary, result: validated.result, usage };
  };

  try {
    return await attempt();
  } catch (firstError) {
    if (firstError instanceof ProviderCallError) {
      throw firstError;
    }
    // Layout JSON is large and occasionally malformed — one retry with the error fed back.
    try {
      const reason = firstError instanceof Error ? firstError.message : "parse error";
      return await attempt(`Your previous response was invalid (${reason}). Return ONLY the corrected JSON object, with no markdown fences.`);
    } catch (secondError) {
      if (secondError instanceof ProviderCallError) {
        throw secondError;
      }
      const reason = secondError instanceof Error ? secondError.message : "unknown error";
      throw new Error(`AI response could not be parsed: ${reason}`);
    }
  }
}
