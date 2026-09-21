import { z } from "zod";

import { ElementJSONSchema, TemplateJSONSchema, hydrateStructuralDefaults } from "@/server/sanitizer";

import { classifyPromptComplexity } from "./complexity";
import { resolveModel } from "./modelRegistry";
import * as anthropicProvider from "./providers/anthropic";
import * as bedrockProvider from "./providers/bedrockClaude";
import * as geminiProvider from "./providers/gemini";
import * as openaiProvider from "./providers/openai";
import type { ProviderCallResult } from "./providers/shared";
import type { AiActionMode, AiProvider, ConcreteTier, GenerateOutcome } from "./types";

export const MAX_TOKENS: Record<AiActionMode, number> = {
  edit_element: 4000,
  edit_layout: 16000,
  generate_layout: 16000,
  // Full-document output (the whole uploaded index.html back). Raised from the previous
  // 16000: the model returns the ENTIRE document as one JSON string, so anything beyond a
  // small page routinely hit that ceiling mid-string, producing an unparseable truncated
  // response ("Unterminated string in JSON..."). See TRUNCATED_RETRY_CAP below for the
  // further adaptive bump this mode's edits get if even this isn't enough.
  edit_raw_html: 32000,
  // Same full-document-output reasoning as edit_raw_html just above — a freshly generated
  // page can be just as large as an edited one.
  generate_raw_html: 32000,
  // A full post as HTML plus excerpt/SEO/category/tag/image-prompt metadata — lighter than
  // a builder layout's nested JSON per token, so a smaller ceiling than edit_layout/
  // generate_layout is enough for a genuinely long post.
  generate_blog_post: 6000,
  // SOL (lib/ai/solAgent.ts) — one turn of the agent loop: some conversational text plus,
  // often, a tool_use block whose "input" can itself be a full designJson/htmlContent
  // payload (e.g. calling publish_landing_page or create_raw_landing_page) — the same
  // shape of output edit_raw_html/generate_layout produce in one shot. Set to the highest
  // existing ceiling (edit_raw_html's 32000) rather than a smaller one: an agent turn that
  // gets cut off mid tool-call JSON is worse than a plain generation mode being cut off,
  // since dispatchMcpTool would then receive unparseable/truncated tool input.
  agent_chat: 32000,
};

/** Ceiling for the one-time adaptive retry when a response comes back truncated (see
 * TruncatedResponseError below) — doubling maxTokens is only useful up to what the model
 * actually supports, and every provider/tier resolveModel can pick from currently supports
 * at least this many output tokens. */
const TRUNCATED_RETRY_CAP = 64000;

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
Formatting is critical — this HTML is rendered as-is, so poor structure reads as a wall of text:
- Every distinct thought/paragraph is its OWN <p> element. Never join multiple paragraphs with <br> or raw newlines, and never let a single <p> run longer than about 4-5 sentences — split it.
- Break the post into sections with <h2> (and <h3> for subsections within a section) every few paragraphs — a post with no headings at all is too dense; add them even if the user's topic wasn't explicitly asking for sections.
- Use <ul>/<ol> for anything that's actually a list (steps, options, examples) instead of writing it as prose with commas.
- No stray whitespace-only text nodes or empty <p></p> elements between blocks — every element in "contentHtml" must contain real content.
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

  if (mode === "generate_raw_html") {
    return `You are Plexo's builder AI. Generate a brand-new, complete, production-quality ${kindLabel} as a single self-contained HTML document, from the user's prompt.
This is the premium, fully hand-crafted alternative to Plexo's drag-and-drop builder — the whole point is design freedom the builder's block system can't offer, so write real, bespoke markup and styling rather than a generic template. Aim for a genuinely polished, professional-grade finish: thoughtful typography and spacing, a real color/visual identity implied by the prompt, and a complete set of sections appropriate to what was asked for (not just a bare hero).
Requirements:
- One complete HTML document: <!DOCTYPE html>, <html>, <head> (including <meta charset>, <meta name="viewport">, a <title>), and <body>. Nothing outside that document.
- All CSS inline in a single <style> block in <head> — no external stylesheets/CDN links, no CSS frameworks. Fully responsive (mobile-first, real breakpoints), since this ships to real visitors on real devices.
- Vanilla JavaScript only, inline in a single <script> block before </body> if the page genuinely needs interactivity (a mobile nav toggle, a simple form handler, smooth-scrolling anchors) — never a framework/library, never a build step, never external <script src>.
- Use real, on-topic copy that fits the prompt — never lorem ipsum or "Company Name" placeholders. Use https://picsum.photos/seed/<any-word>/<width>/<height> for any photo the page needs (a real, working placeholder-image service), never a broken/fake image URL.
- Semantic HTML5 (header/nav/main/section/footer, proper heading hierarchy) — this also renders and reads well without the CSS/JS, not just with it.
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose outside the JSON:
{ "summary": "<one or two short sentences describing the page you built>", "result": "<the COMPLETE HTML document as a single string, starting from <!DOCTYPE html>>" }`;
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
DESIGN QUALITY — this is what separates a premium-looking site from a generic AI template, follow it on every section:
Palette: choose one small, deliberate system before writing any row — a near-black/navy/charcoal "ink" plus an off-white/cream "paper" (never pure #000000/#ffffff), one brand accent color used sparingly for CTAs and highlights only, and 2-3 muted grays derived from the ink color for secondary text. Reuse these exact hex values everywhere rather than inventing a new color per section, and default to this kind of restrained, brand-specific palette instead of a generic purple/blue SaaS gradient unless the prompt clearly calls for something else.
Typography: at most three font families — one serif or otherwise distinctive display font for headings (line-height 1.0-1.25, weight 500-600, never 700+), one clean sans-serif for body copy and buttons (paragraphs at line-height 1.6-1.75), and optionally one monospace or condensed font in uppercase with letterSpacing around "0.14em"-"0.18em" at a small fontSize (11-13px), used only for short eyebrow labels above a heading, never for headings or body copy. Give headings and paragraphs a "maxWidth" (roughly 480-780px) so text doesn't stretch edge-to-edge on wide screens.
Section shell: every section is two layers, using a column's "nestedRows" array (a row nested inside a column, same shape as a top-level row) — an outer row carries the section's backgroundColor full-bleed to the viewport edge, with horizontal padding of either "0" or a fluid "clamp(20px, 6vw, 56px)" (never a fixed px value), containing one "100%"-width column whose "nestedRows" holds an inner row that caps actual content at a maxWidth around 1200-1440px. Alternate background colors between sections (ink, paper, one warm neutral, one soft accent tint) for visual rhythm instead of leaving every section white.
Restraint: borderRadius near 0 by default for an editorial, premium feel — reserve a rounded pill (~100px) only for tags/badges, and small radii (2-10px) only for buttons/cards/inputs. Use boxShadow rarely, only as a soft, large, low-opacity shadow tinted with the ink color (never plain black) — most elements should have none. textTransform: uppercase is reserved for small eyebrow labels only.
Layout variety: vary column-width splits across sections (an asymmetric ~55/45 hero, a 33/33/33 feature grid, alternating ~60/40 image-and-text rows) instead of repeating the same centered block or identical card grid everywhere. Buttons should look understated — solid accent fill or a text link with a colored underline/arrow, weight 600, padding around "14px 26px", sharp-to-small corner radius, and specific action copy ("Book a Consultation →") rather than generic "Click Here". Images need descriptive, specific "alt" text and an intentional width/maxWidth so they don't stretch full-bleed by accident.
Every row, column, and element must include a unique, non-empty "id" string. Every row and element must include "style" (and every element "attributes") as an object — use {} if there is nothing to set, never omit the key. Every column must include a "width" string (e.g. "100%") and an "elements" array — required even when the column's real content lives in "nestedRows" instead, in which case pass "elements": [].
Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose:
{ "summary": "<one or two short sentences describing what you changed or built>", "result": <the full TemplateJSON, i.e. { "body": { "style": {...}, "rows": [...] } }> }`;
}

function resultSchemaFor(mode: AiActionMode) {
  if (mode === "edit_raw_html" || mode === "generate_raw_html") {
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
    case "bedrock_claude":
      return bedrockProvider.generate(params);
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

/** Thrown when the provider itself reports the response was cut short by its output-token
 * ceiling (see the `truncated` flag each provider module sets) — caught separately from a
 * genuine JSON.parse/schema error so the retry can hand the model a bigger budget instead of
 * uselessly re-asking it to "fix" JSON that was never going to be complete at the same limit. */
class TruncatedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TruncatedResponseError";
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

  const attempt = async (opts?: { extraNote?: string; maxTokensOverride?: number }): Promise<GenerateOutcome> => {
    // Raw HTML is embedded directly rather than JSON.stringify'd — stringifying would
    // escape every quote/newline in the document, burning tokens and making the markup
    // harder for the model to read as an actual document rather than a JSON string.
    const contextBlock = params.mode === "edit_raw_html"
      ? `Current HTML document:\n${(trimmedContext as { html: string }).html}`
      // generate_raw_html starts from nothing — no context to echo back at all, unlike
      // every other mode (even generate_layout gets a real, if empty, TemplateJSON skeleton).
      : params.mode === "generate_raw_html"
        ? ""
        : `Current JSON:\n${JSON.stringify(trimmedContext)}`;
    const userPrompt = `${opts?.extraNote ? `${opts.extraNote}\n\n` : ""}User instruction: ${params.prompt}${contextBlock ? `\n\n${contextBlock}` : ""}`;
    const tokensForThisCall = opts?.maxTokensOverride ?? maxTokens;
    let text: string;
    let usage: ProviderCallResult["usage"];
    let truncated: ProviderCallResult["truncated"];
    try {
      ({ text, usage, truncated } = await callProvider(
        params.provider,
        model,
        params.apiKey,
        systemPrompt,
        userPrompt,
        tokensForThisCall,
      ));
    } catch (err) {
      // Auth/network/rate-limit failures from the provider are not the model
      // returning malformed JSON — don't relabel them as parse errors, and
      // don't burn a retry re-asking the provider to "fix its JSON".
      const reason = err instanceof Error ? err.message : "unknown error";
      throw new ProviderCallError(`AI provider request failed: ${reason}`);
    }
    if (truncated) {
      throw new TruncatedResponseError(
        `the response was cut off before it finished (hit the ${tokensForThisCall}-token output limit)`,
      );
    }
    const cleaned = cleanJsonString(text);
    const parsed = JSON.parse(cleaned);
    // LLMs frequently omit structural bookkeeping (id/style/attributes/width) on repeated
    // rows/columns/elements — hydrate the same way MCP/publish/compile/templates callers do
    // before validating, instead of failing the whole response over missing defaults.
    if (
      params.mode !== "edit_element" &&
      params.mode !== "edit_raw_html" &&
      params.mode !== "generate_raw_html" &&
      params.mode !== "generate_blog_post" &&
      parsed &&
      typeof parsed === "object" &&
      "result" in parsed
    ) {
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
    try {
      if (firstError instanceof TruncatedResponseError) {
        // The content itself was cut short, not malformed — retrying with the same budget
        // would just get cut off at the same point, so bump it instead of sending a
        // "fix your JSON" note (there's nothing to fix, there's more to generate).
        const biggerTokens = Math.min(maxTokens * 2, TRUNCATED_RETRY_CAP);
        return await attempt({ maxTokensOverride: biggerTokens });
      }
      // Layout JSON is large and occasionally malformed — one retry with the error fed back.
      const reason = firstError instanceof Error ? firstError.message : "parse error";
      return await attempt({ extraNote: `Your previous response was invalid (${reason}). Return ONLY the corrected JSON object, with no markdown fences.` });
    } catch (secondError) {
      if (secondError instanceof ProviderCallError) {
        throw secondError;
      }
      if (secondError instanceof TruncatedResponseError) {
        throw new Error(
          "the AI response was cut off before it finished, even after increasing the output limit — try a shorter or more targeted instruction",
        );
      }
      const reason = secondError instanceof Error ? secondError.message : "unknown error";
      throw new Error(`AI response could not be parsed: ${reason}`);
    }
  }
}
