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
import { brandColorCss } from "./brandPreview";
import { DOMAIN_STOCK_PHOTOS, detectPersonalizationDomain } from "./personalize";

export { extractTextNodes, applyTextNodes, MAX_NODES, type TextNode } from "./htmlText";
import { extractTextNodes, applyTextNodes, type TextNode } from "./htmlText";

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
  const allowed = new Set(nodes.map((n) => String(n.id)));
  const replacements: Record<string, string> = {};
  // Long designs are written in small batches: each reply stays short (so it can't be cut off) and a slow or odd reply only costs one batch, not the page.
  const batches: TextNode[][] = [];
  for (let i = 0; i < nodes.length; i += WRITE_BATCH) batches.push(nodes.slice(i, i + WRITE_BATCH));
  const writeBatch = async (batch: TextNode[]): Promise<void> => {
    const prompt = user.replace(/Snippets:[\s\S]*$/, `Snippets:\n${JSON.stringify(batch.map((n) => [n.id, n.text]))}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await askSol(ctx, system, prompt, 4000);
      const parsed = parseJsonObject(text);
      const raw = parsed && typeof parsed.r === "object" && parsed.r && !Array.isArray(parsed.r) ? (parsed.r as Record<string, unknown>) : salvageReplacements(text);
      let got = 0;
      for (const [id, value] of Object.entries(raw)) {
        if (allowed.has(id) && typeof value === "string" && value.trim()) {
          replacements[id] = value.trim().slice(0, 600);
          got++;
        }
      }
      if (got > 0) return;
    }
  };
  for (let i = 0; i < batches.length; i += 3) await Promise.all(batches.slice(i, i + 3).map(writeBatch));
  if (Object.keys(replacements).length === 0) throw new PlainError("SOL couldn't finish the words this time. Please try again: you haven't lost anything.");
  return replacements;
}

/** Most snippets sent to SOL per request when rewriting a design's words. */
const WRITE_BATCH = 70;

/** An error whose message is already written for the site owner and can be shown as it is. */
export class PlainError extends Error {}

/** The finished `"id": "text"` pairs out of a reply that was cut off or isn't clean JSON. */
export function salvageReplacements(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/"(\d{1,4})"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try {
      out[m[1]] = JSON.parse(`"${m[2]}"`) as string;
    } catch {
      /* skip a broken entry */
    }
  }
  return out;
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

  const colorCss = input.brandColor ? brandColorCss(input.brandColor) : null;
  if (colorCss && html.includes("</head>") && !html.includes("data-plx-brand-preview")) {
    html = html.replace("</head>", `<style data-sol-brand="true">${colorCss}</style></head>`);
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
