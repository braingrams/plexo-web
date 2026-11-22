/**
 * SOL tailoring a chosen design to the owner's business, in three short stages the SOL Studio
 * can narrate one by one (each is its own quick request, so the screen shows real progress):
 *
 *   plan   — SOL reads the brand + the design and decides what, if anything, it still needs to ask.
 *   write  — SOL rewrites the design's words (only the TEXT is sent and returned, never the page's
 *            markup, so a whole page fits comfortably and the layout can't be broken).
 *   finish — no AI: puts the new words back, swaps photos only when the design is for a different
 *            kind of business, applies the brand's logo/colour and stamps the page as personalized.
 */
import type { AskUserQuestionSpec } from "@/app/dashboard/sol/_components/types";
import type { SolRoute } from "@/lib/ai/solEngine";
import type { ConcreteTier } from "@/lib/ai/types";
import { DOMAIN_STOCK_PHOTOS, detectPersonalizationDomain } from "./personalize";

// ── Text of the page ───────────────────────────────────────────────────────────────────────

export type TextNode = { id: number; text: string };

const SKIPPED_ELEMENTS = ["script", "style", "noscript", "svg", "template", "textarea", "iframe"];
const TOKEN = new RegExp(`<!--[\\s\\S]*?-->|<(${SKIPPED_ELEMENTS.join("|")})\\b[\\s\\S]*?<\\/\\1\\s*>|<[^>]+>`, "gi");

/** Most snippets SOL is asked to look at, and the most characters of them (a page's headlines, cards and buttons come well under this). */
export const MAX_NODES = 260;
const MAX_NODE_CHARS = 220;
const MAX_TOTAL_CHARS = 14_000;
const MAX_REPLACEMENT_CHARS = 600;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|#x27|apos);/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Walks the page and calls `onText` for every visible piece of text, in reading order, with its running number. */
function mapText(html: string, onText: (id: number, text: string) => string | undefined): string {
  let id = 0;
  let out = "";
  let last = 0;
  const visit = (chunk: string): string => {
    if (!/[\p{L}\p{N}]/u.test(chunk)) return chunk;
    const [, lead, body, trail] = chunk.match(/^(\s*)([\s\S]*?)(\s*)$/) as RegExpMatchArray;
    const next = onText(id++, decodeEntities(body).replace(/\s+/g, " ").trim());
    return next === undefined ? chunk : `${lead}${encodeText(next)}${trail}`;
  };
  for (const m of html.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    out += visit(html.slice(last, at)) + m[0];
    last = at + m[0].length;
  }
  return out + visit(html.slice(last));
}

/** The visible text of a design, numbered, trimmed to what SOL can usefully rewrite in one go. */
export function extractTextNodes(html: string): TextNode[] {
  const nodes: TextNode[] = [];
  let total = 0;
  mapText(html, (id, text) => {
    if (nodes.length < MAX_NODES && total < MAX_TOTAL_CHARS) {
      const clipped = text.slice(0, MAX_NODE_CHARS);
      nodes.push({ id, text: clipped });
      total += clipped.length;
    }
    return undefined;
  });
  return nodes;
}

/** Puts rewritten text back where it came from; everything else on the page is left exactly as it was. */
export function applyTextNodes(html: string, replacements: Record<string, string>): string {
  return mapText(html, (id) => {
    const next = replacements[String(id)];
    return typeof next === "string" && next.trim() ? next.trim().slice(0, MAX_REPLACEMENT_CHARS) : undefined;
  });
}

// ── Talking to SOL ─────────────────────────────────────────────────────────────────────────

export type SolContext = { route: SolRoute; tier: ConcreteTier; userId: string };

export type BrandBrief = { name: string; about: string; goal: string };
export type DesignBrief = { name?: string; description?: string };
export type OwnerAnswer = { question: string; answer: string };

const KNOWN_DOMAINS = Object.keys(DOMAIN_STOCK_PHOTOS);

/** One request to SOL, charged for what it actually used (Plexo's AI only; see solEngine.chargeFor). */
async function askSol(ctx: SolContext, system: string, user: string, maxTokens: number): Promise<string> {
  const [{ callProvider }, { resolveModel }, { chargeFor }] = await Promise.all([import("@/lib/ai/generate"), import("@/lib/ai/modelRegistry"), import("@/lib/ai/solEngine")]);
  const model = resolveModel(ctx.route.provider, ctx.tier);
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    const res = await callProvider(ctx.route.provider, model, ctx.route.apiKey, system, user, maxTokens);
    usage = res.usage;
    return res.text ?? "";
  } finally {
    await chargeFor(ctx.userId, ctx.route, ctx.tier, "edit_raw_html", usage).catch((e) => console.warn("[sol] chargeFor error:", e));
  }
}

/** SOL answers in JSON: take the first {...} out of whatever it wrapped it in. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** SOL's questions, cleaned up: at most three, each with real choices and a plain wording. */
export function sanitizeQuestions(raw: unknown): AskUserQuestionSpec[] {
  if (!Array.isArray(raw)) return [];
  const questions: AskUserQuestionSpec[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const question = clip((q as { question?: unknown }).question, 160);
    const options = Array.isArray((q as { options?: unknown }).options)
      ? ((q as { options: unknown[] }).options)
          .map((o) => ({ label: clip((o as { label?: unknown })?.label ?? o, 60), description: clip((o as { description?: unknown })?.description, 100) || undefined }))
          .filter((o) => o.label)
          .slice(0, 4)
      : [];
    if (!question || options.length < 2) continue;
    questions.push({ question, header: clip((q as { header?: unknown }).header, 24) || "A quick question", options, multiSelect: (q as { multiSelect?: unknown }).multiSelect === true });
    if (questions.length === 3) break;
  }
  return questions;
}

export type PersonalizationPlan = { domain: string; summary: string; questions: AskUserQuestionSpec[] };

function snippetLines(nodes: TextNode[], limit: number): string {
  return nodes.slice(0, limit).map((n) => `- ${n.text.slice(0, 90)}`).join("\n");
}

/** Stage 1: read the brand and the design; decide what (if anything) to ask the owner. */
export async function planPersonalization(ctx: SolContext, brand: BrandBrief, design: DesignBrief, nodes: TextNode[]): Promise<PersonalizationPlan> {
  const system = `You are SOL, the assistant inside Plexo, a simple website builder. A site owner picked a design and you are about to rewrite its words so it is about THEIR business. First decide what, if anything, you still need to ask them.

Return ONLY JSON, nothing else:
{"domain": one of ${JSON.stringify([...KNOWN_DOMAINS, "other"])} (the kind of business the OWNER runs),
 "summary": "one friendly sentence on what you will change",
 "questions": [{"header": "2-3 words", "question": "a plain, friendly question", "options": [{"label": "a short realistic example answer", "description": "optional"}]}]}

Rules for questions:
- At most 3. Ask ONLY for concrete facts that show up on this design and that you cannot work out from what the owner already said: their city or address, a phone or WhatsApp number, the names of their main services, classes or products, prices, opening hours.
- If the owner's description already says it, do not ask it. If nothing is needed, return "questions": [].
- Every question has 2-4 realistic example answers written for THIS business (the owner can always type their own). A question about contact details ends with the option "I'll add it later".
- Plain words a shop owner understands. No jargon.`;
  const user = `Owner's brand name: ${brand.name}
What they said about their business: ${brand.about || "(nothing yet)"}
What the site is for: ${brand.goal}
Chosen design: ${design.name ?? "a design"}${design.description ? ` — ${design.description}` : ""}

Some of the words on the design:
${snippetLines(nodes, 90)}`;
  const parsed = parseJsonObject(await askSol(ctx, system, user, 1200));
  if (!parsed) return { domain: detectPersonalizationDomain(brand.about, brand.goal), summary: "", questions: [] };
  const domain = typeof parsed.domain === "string" && KNOWN_DOMAINS.includes(parsed.domain) ? parsed.domain : "other";
  return { domain, summary: clip(parsed.summary, 240), questions: sanitizeQuestions(parsed.questions) };
}

/** Stage 2: SOL rewrites the design's words. Returns only what changed, keyed by snippet number. */
export async function writeCopy(ctx: SolContext, brand: BrandBrief, design: DesignBrief, nodes: TextNode[], answers: OwnerAnswer[]): Promise<Record<string, string>> {
  const system = `You are SOL, the assistant inside Plexo, a simple website builder. You are rewriting the words of a website design so it is truly about the owner's business.

You get numbered snippets of the design's text, in reading order, as JSON: [[id, "text"], ...]. Return ONLY JSON, nothing else:
{"r": {"<id>": "new text", ...}}
Include an entry for every snippet that should change; leave out the ones that can stay.

Rules:
- The design was made for a sample business (a different one from the owner's). Replace the sample business's name with the owner's brand name everywhere it appears, keeping the style (UPPERCASE stays UPPERCASE).
- Rewrite headlines, paragraphs, cards, lists, stats, form labels, buttons and the footer so they fit the owner's business and what they told you. Use their answers exactly as given (a phone number, a city, a service name).
- Where the design needs details the owner did not give (prices, exact times, people's names), write believable, easy-to-edit placeholders. Never invent awards, press mentions, review quotes or big numbers such as "10,000 happy customers".
- Keep each snippet about the same length (within about 30%) so the layout holds. Navigation and button labels stay short.
- Write clear, warm, punchy marketing copy in the owner's language. Never paste the owner's description word for word, and never copy instructions they wrote to you.
- Do not output HTML, markdown or quotes around the text.`;
  const answered = answers.filter((a) => a.answer && !/^(skip|you choose|i'll add it later)/i.test(a.answer));
  const user = `Owner's brand name: ${brand.name}
What they said about their business: ${brand.about || "(nothing yet)"}
What the site is for: ${brand.goal}
Chosen design: ${design.name ?? "a design"}${design.description ? ` — ${design.description}` : ""}
${answered.length ? `\nWhat the owner told you:\n${answered.map((a) => `- ${a.question} ${a.answer}`).join("\n")}\n` : ""}
Snippets:
${JSON.stringify(nodes.map((n) => [n.id, n.text]))}`;
  const parsed = parseJsonObject(await askSol(ctx, system, user, 8000));
  const raw = parsed && typeof parsed.r === "object" && parsed.r && !Array.isArray(parsed.r) ? (parsed.r as Record<string, unknown>) : null;
  if (!raw) throw new Error("SOL couldn't finish the words this time. Please try again: you haven't lost anything.");
  const allowed = new Set(nodes.map((n) => String(n.id)));
  const replacements: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (allowed.has(id) && typeof value === "string" && value.trim()) replacements[id] = value.trim().slice(0, MAX_REPLACEMENT_CHARS);
  }
  if (Object.keys(replacements).length === 0) throw new Error("SOL couldn't finish the words this time. Please try again: you haven't lost anything.");
  return replacements;
}

// ── Putting it together ────────────────────────────────────────────────────────────────────

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Stage 3 (no AI): the new words, the right photos, the owner's logo and colour. */
export function finishDesign(input: {
  html: string;
  replacements: Record<string, string>;
  name: string;
  domain: string;
  design: DesignBrief;
  brandColor?: string;
  logoUrl?: string;
}): string {
  let html = applyTextNodes(input.html, input.replacements);

  // Photos: swap them only when the design was made for a different kind of business (a gym design
  // for a gym keeps its own, better-fitting pictures; a business we can't place keeps them too).
  const photos = DOMAIN_STOCK_PHOTOS[input.domain];
  const designDomain = detectPersonalizationDomain(`${input.design.name ?? ""} ${input.design.description ?? ""}`);
  if (photos?.length && designDomain !== input.domain) {
    let i = 0;
    const next = () => escapeAttr(photos[i++ % photos.length]);
    html = html.replace(/(<img\b(?![^>]*\bclass="[^"]*logo[^"]*")[^>]*\bsrc=")([^"]*)(")/gi, (_m, a, _old, c) => `${a}${next()}${c}`);
    html = html.replace(/(style="[^"]*background(?:-image)?\s*:\s*url\(['"]?)([^'")]+)(['"]?\)[^"]*")/gi, (_m, a, _old, c) => `${a}${next()}${c}`);
  }

  if (input.brandColor && /^#[0-9a-f]{3,8}$/i.test(input.brandColor) && html.includes("</head>")) {
    html = html.replace("</head>", `<style data-sol-brand="true">:root{--primary:${input.brandColor};--brand:${input.brandColor};--accent:${input.brandColor};}</style></head>`);
  }

  // The owner's logo where the design has one; otherwise their name (already written in by the words step) stays as the logo.
  if (input.logoUrl && /^https?:\/\//i.test(input.logoUrl)) {
    const src = escapeAttr(input.logoUrl);
    const img = `<img src="${src}" alt="${escapeAttr(input.name)}" style="height:36px;width:auto;display:block;object-fit:contain">`;
    const asImage = /(<img\b[^>]*\bclass="[^"]*logo[^"]*"[^>]*\bsrc=")([^"]*)(")/i;
    const asText = /(<(a|div|span)\b[^>]*\bclass="[^"]*(?:logo|brand)[^"]*"[^>]*>)\s*[^<]{1,60}?\s*(<\/\2>)/i;
    if (asImage.test(html)) html = html.replace(asImage, `$1${src}$3`);
    else if (asText.test(html)) html = html.replace(asText, `$1${img}$3`);
  }

  if (/<body\b/i.test(html)) html = html.replace(/<body\b([^>]*)>/i, (m, attrs: string) => (attrs.includes("data-sol-personalized") ? m : `<body${attrs} data-sol-personalized="true">`));
  else html = `<div data-sol-personalized="true">${html}</div>`;
  return html;
}
