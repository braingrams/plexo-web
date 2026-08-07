import { z } from "zod";

import { ElementJSONSchema, TemplateJSONSchema, hydrateStructuralDefaults } from "@/server/sanitizer";

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
  // Full-document output (the whole uploaded index.html back), matching the largest
  // existing tier rather than a fresh guess.
  edit_raw_html: 16000,
  // A full post as HTML plus excerpt/SEO/category/tag/image-prompt metadata — lighter than
  // a builder layout's nested JSON per token, so a smaller ceiling than edit_layout/
  // generate_layout is enough for a genuinely long post.
  generate_blog_post: 6000,
};

const CORE_ELEMENT_TYPES = [
  "text", "button", "image", "spacer", "divider", "card", "form_container",
  "input", "textarea", "select", "heading", "paragraph", "carousel",
  "video", "social", "menu", "html", "table", "timer", "icon", "accordion",
];

// Only offered to the model when editing an actual blog post template (isBlogLayout) —
// these are opaque per-post placeholders resolved at render time, not real page content,
// so suggesting them on an ordinary landing page/email would just produce dead blocks.
const BLOG_ELEMENT_TYPES = [
  "blog_title", "blog_content", "blog_featured_image", "blog_date",
  "blog_author", "blog_categories", "blog_comments", "blog_post_list",
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

function buildSystemPrompt(mode: AiActionMode, templateKind: "EMAIL" | "LANDING_PAGE", isBlogLayout: boolean): string {
  const kindLabel = templateKind === "EMAIL" ? "email template" : "landing page";

  if (mode === "generate_blog_post") {
    return `You are Plexo's blog writing assistant. Write a complete, publish-ready blog post based on the user's topic.
Write "contentHtml" as clean semantic HTML body content only — <h2>/<h3> for headings, <p> for paragraphs, <ul>/<ol>/<li> for lists, <blockquote> for quotes where useful. No <html>/<head>/<body> wrapper, no inline styles, no <script>.
Also write a 1-2 sentence "excerpt", an SEO "metaTitle" (max 60 characters) and "metaDescription" (max 160 characters), 1-3 "categories" (reuse a name from the existing categories list in the context below when one genuinely fits, otherwise propose a short new one), 3-6 relevant "tags" (short keywords or phrases), and a vivid one-sentence "imagePrompt" describing an ideal photographic or editorial-illustration featured image for this post (no embedded text/words in the image itself).
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose outside the JSON:
{ "summary": "<one short sentence describing the post you wrote>", "result": { "title": "...", "excerpt": "...", "contentHtml": "...", "metaTitle": "...", "metaDescription": "...", "categories": ["..."], "tags": ["..."], "imagePrompt": "..." } }`;
  }

  if (mode === "edit_raw_html") {
    return `You are Plexo's builder AI. You edit a complete, self-contained static HTML document (an uploaded site, not a Plexo builder layout) according to the user's instruction.
Preserve everything the user didn't ask you to change — structure, existing <style>/<script> blocks, classes, attributes, and functionality — and make only the requested edit.
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose outside the JSON:
{ "summary": "<one short sentence describing the change you made>", "result": "<the COMPLETE modified HTML document as a single string, starting from <!DOCTYPE html> or <html>, not a diff or partial snippet>" }`;
  }

  if (mode === "edit_element") {
    return `You are Plexo's builder AI. You modify a single element's JSON (style + attributes) inside a ${kindLabel} builder according to the user's instruction.
The "result" you return is applied by merging "style" and "attributes" over the element's current values — so "style" and "attributes" must each be the COMPLETE object, not a partial diff: include every existing key that isn't changing, unchanged, alongside the key(s) you are changing. Never omit an existing key just because its value didn't change, and never return an empty object for "style" or "attributes" unless the element genuinely has no style/attributes at all.
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose:
{ "summary": "<one short sentence describing the change you made>", "result": <the full updated element JSON — keep the same "id" and "type" as given, and return the COMPLETE "style" and "attributes" objects (all existing keys plus your changes)> }`;
  }

  const modeInstruction = mode === "generate_layout"
    ? `The canvas is currently empty. Generate a complete new ${kindLabel} layout (rows, columns, elements) that fulfills the user's prompt.`
    : `Modify the given ${kindLabel} layout (add/remove/reorder rows, columns, elements; restyle sections) according to the user's instruction.`;

  const elementTypes = isBlogLayout ? [...CORE_ELEMENT_TYPES, ...BLOG_ELEMENT_TYPES] : CORE_ELEMENT_TYPES;
  const blogGuidance = isBlogLayout
    ? ` This is a blog post template — blog_title, blog_content, blog_featured_image, blog_date, blog_author, blog_categories, blog_comments, and blog_post_list are placeholder blocks the renderer fills in per-post; they take no meaningful "attributes" (still include "attributes": {}). Use blog_title and blog_content exactly once each; the rest are optional and normally appear at most once too.`
    : "";

  return `You are Plexo's builder AI. ${modeInstruction}
Allowed element types: ${elementTypes.join(", ")}.${blogGuidance}
Every row, column, and element must include a unique, non-empty "id" string. Every row and element must include "style" (and every element "attributes") as an object — use {} if there is nothing to set, never omit the key. Every column must include a "width" string (e.g. "100%").
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose:
{ "summary": "<one or two short sentences describing what you changed or built>", "result": <the full TemplateJSON, i.e. { "body": { "style": {...}, "rows": [...] } }> }`;
}

function resultSchemaFor(mode: AiActionMode) {
  if (mode === "edit_raw_html") {
    return z.object({ summary: z.string().max(2000), result: z.string().min(1) });
  }
  if (mode === "generate_blog_post") {
    return z.object({
      summary: z.string().max(2000),
      result: z.object({
        title: z.string().min(1).max(200),
        excerpt: z.string().max(400).optional().default(""),
        contentHtml: z.string().min(1),
        metaTitle: z.string().max(70).optional().default(""),
        metaDescription: z.string().max(200).optional().default(""),
        categories: z.array(z.string()).max(5).optional().default([]),
        tags: z.array(z.string()).max(10).optional().default([]),
        imagePrompt: z.string().min(1).max(500),
      }),
    });
  }
  return z.object({
    summary: z.string().max(2000),
    result: mode === "edit_element" ? ElementJSONSchema : TemplateJSONSchema,
  });
}

/** Drops heavy/irrelevant fields before sending the template to the model — token efficiency. */
function trimContext(mode: AiActionMode, context: unknown): unknown {
  if (mode === "edit_element" || mode === "edit_raw_html" || mode === "generate_blog_post" || context === null || typeof context !== "object") {
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
  /** True only when editing an actual blog post template — gates whether blog_* element
   * types are offered to the model at all (see BLOG_ELEMENT_TYPES above). */
  isBlogLayout?: boolean;
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
  const systemPrompt = buildSystemPrompt(params.mode, params.templateKind, params.isBlogLayout ?? false);
  const trimmedContext = trimContext(params.mode, params.context);
  const schema = resultSchemaFor(params.mode);
  const maxTokens = MAX_TOKENS[params.mode];

  const attempt = async (extraNote?: string): Promise<GenerateOutcome> => {
    // Raw HTML is embedded directly rather than JSON.stringify'd — stringifying would
    // escape every quote/newline in the document, burning tokens and making the markup
    // harder for the model to read as an actual document rather than a JSON string.
    const contextBlock = params.mode === "edit_raw_html"
      ? `Current HTML document:\n${(trimmedContext as { html: string }).html}`
      : `Current JSON:\n${JSON.stringify(trimmedContext)}`;
    const userPrompt = `${extraNote ? `${extraNote}\n\n` : ""}User instruction: ${params.prompt}\n\n${contextBlock}`;
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
    // LLMs frequently omit structural bookkeeping (id/style/attributes/width) on repeated
    // rows/columns/elements — hydrate the same way MCP/publish/compile/templates callers do
    // before validating, instead of failing the whole response over missing defaults.
    if (params.mode !== "edit_element" && params.mode !== "edit_raw_html" && params.mode !== "generate_blog_post" && parsed && typeof parsed === "object" && "result" in parsed) {
      parsed.result = hydrateStructuralDefaults(parsed.result);
    }
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
