import { generate } from "@/lib/ai/providers/bedrockClaude";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { chargeUsage, ensureCreditPeriod, estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import { htmlOutlineLines } from "@/lib/sites/htmlOutline";
import { safeFetch } from "@/lib/siteImport/fetchSafe";
import { originalImageUrl } from "./imageSize";
import type { SitePage } from "./sitePages";

/**
 * Page titles and picture descriptions, written ONCE when the owner switches the fix on (never per visit), stored with the
 * site's health settings, editable in the preview, and served as stored.
 *
 * Cost control: Plexo's own small model; at most MAX_TITLES pages and MAX_PICTURES pictures per run (the preview says when
 * there are more, and "Write more" continues); the account's credits are checked first and the real usage is billed after;
 * stored texts are reused, so opening the preview again costs nothing; only the Regenerate button writes again.
 */

export const MAX_TITLES = 15;
export const MAX_PICTURES = 12;
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;
const TITLE_MAX = 65;
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type Usage = { inputTokens: number; outputTokens: number };
export type AiOutcome = { ok: true; texts: Record<string, string>; skipped: string[]; capped: boolean; credits: number } | { ok: false; error: string };

const clean = (s: string, max: number) => s.replace(/^["'“”\s]+|["'“”\s]+$/g, "").replace(/\s+/g, " ").slice(0, max).trim();

/** Pages whose own HTML has no usable title. */
export function pagesWithoutTitle(pages: SitePage[]): SitePage[] {
  return pages.filter((p) => {
    const head = p.html.slice(0, Math.max(p.html.search(/<\/head\s*>/i), 0) || 20000);
    const t = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim() ?? "";
    return t.length < 3;
  });
}

/** Pictures with no description: unique addresses we can read, with the page they first appear on. */
export function picturesWithoutDescription(pages: SitePage[], base: string): { url: string; page: string }[] {
  const out = new Map<string, string>();
  for (const p of pages) {
    for (const m of p.html.matchAll(/<img\b([^>]*)>/gi)) {
      const attrs = m[1];
      const alt = attrs.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
      if ((alt && (alt[2] ?? alt[3] ?? "").trim()) || /\brole=["']presentation["']/i.test(attrs) || /\baria-hidden=["']true["']/i.test(attrs)) continue;
      const sm = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const src = sm?.[1] ?? sm?.[2];
      const url = src ? originalImageUrl(src, base) : null;
      if (url && !out.has(url)) out.set(url, p.name || p.path);
    }
  }
  return [...out].map(([url, page]) => ({ url, page }));
}

async function preflight(userId: string, inputChars: number, maxOutputTokens: number): Promise<string | null> {
  try {
    const balance = await ensureCreditPeriod(userId);
    const worst = estimateWorstCaseCost("bedrock_claude", "BASIC", "edit_element", inputChars, maxOutputTokens);
    if (balance.available < worst) return "You do not have enough AI credits left this month to write these. Your pages stay as they are. You can add credits, or type the texts yourself.";
  } catch (err) {
    console.error("site health: could not check credits:", err instanceof Error ? err.message : "unknown error");
    return "We could not check your AI credits just now. Please try again in a moment.";
  }
  return null;
}

async function bill(userId: string, usage: Usage): Promise<number> {
  try {
    const r = await chargeUsage(userId, { provider: "bedrock_claude", tier: "BASIC", mode: "edit_element", usage });
    return r.creditsCharged;
  } catch (err) {
    console.error("site health: could not bill credits:", err instanceof Error ? err.message : "unknown error");
    return 0;
  }
}

/** One title per page that has none, from the page's own words. Keys are page paths. */
export async function writeTitles(userId: string, siteName: string, pages: SitePage[], only?: string[]): Promise<AiOutcome> {
  const wanted = pagesWithoutTitle(pages).filter((p) => !only || only.includes(p.path));
  const list = wanted.slice(0, MAX_TITLES);
  if (!list.length) return { ok: true, texts: {}, skipped: [], capped: false, credits: 0 };
  const material = list.map((p, i) => {
    const lines = htmlOutlineLines(p.html, 40).filter((l) => l.kind === "heading" || l.kind === "text").map((l) => l.text).join(" | ").slice(0, 500);
    return `${i + 1}. address ${p.path} (called "${p.name}"): ${lines || "no readable text"}`;
  }).join("\n");
  const refusal = await preflight(userId, material.length + 600, 40 * list.length + 40);
  if (refusal) return { ok: false, error: refusal };
  try {
    const res = await generate({
      model: resolveModel("bedrock_claude", "BASIC"),
      apiKey: "",
      systemPrompt: `You write the page title shown in the browser tab and in Google results. For each numbered page reply with ONE line: the number, a full stop, a space, then the title. Titles are 25 to 60 characters, plain words, say what the page is about, end with " | ${siteName}" only if it fits. No quotes, no emoji, no hype. Use only facts from the text you are given.`,
      userPrompt: `Website: ${siteName}\n\n${material}`,
      maxTokens: 40 * list.length + 40,
    });
    const credits = await bill(userId, { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 });
    const texts: Record<string, string> = {};
    for (const line of (res.text ?? "").split("\n")) {
      const m = line.match(/^\s*(\d+)\.\s+(.+)$/);
      const page = m ? list[Number(m[1]) - 1] : undefined;
      if (!m || !page) continue;
      let t = clean(m[2], 120);
      if (t.length > TITLE_MAX) t = `${t.slice(0, TITLE_MAX - 1).trimEnd()}…`;
      if (t.length >= 8) texts[page.path] = t;
    }
    const skipped = list.filter((p) => !texts[p.path]).map((p) => p.name || p.path);
    return { ok: true, texts, skipped, capped: wanted.length > list.length, credits };
  } catch (err) {
    console.error("site health: could not write titles:", err instanceof Error ? err.message : "unknown error");
    return { ok: false, error: "We could not write the titles just now. Please try again in a moment." };
  }
}

async function readPicture(url: string): Promise<{ mediaType: string; data: string } | null> {
  try {
    const res = await safeFetch(url, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(8000), maxRedirects: 3 });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !res.body || !VISION_TYPES.has(type)) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > MAX_PICTURE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    return { mediaType: type, data: Buffer.concat(chunks).toString("base64") };
  } catch {
    return null;
  }
}

/** A short description for each picture, written by looking at it. Keys are picture addresses. Pictures we cannot open are skipped, never guessed. */
export async function writePictureDescriptions(userId: string, siteName: string, pictures: { url: string; page: string }[]): Promise<AiOutcome> {
  const list = pictures.slice(0, MAX_PICTURES);
  if (!list.length) return { ok: true, texts: {}, skipped: [], capped: false, credits: 0 };
  // About 1,600 tokens (roughly 5,000 characters) per picture plus the question.
  const refusal = await preflight(userId, list.length * 5200, 60 * list.length);
  if (refusal) return { ok: false, error: refusal };
  const texts: Record<string, string> = {};
  const skipped: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (let i = 0; i < list.length; i += 3) {
    await Promise.all(
      list.slice(i, i + 3).map(async (p) => {
        const pic = await readPicture(p.url);
        if (!pic) {
          skipped.push(p.page);
          return;
        }
        try {
          const res = await generate({
            model: resolveModel("bedrock_claude", "BASIC"),
            apiKey: "",
            systemPrompt: `You write alt text for a picture on the website "${siteName}", for people who cannot see it. Reply with ONLY the description: one short sentence, 6 to 15 words, saying what is in the picture. No "image of" or "picture of", no quotes, no guessing names of people or places. If the picture is only decoration (a plain background or pattern), reply with exactly: DECORATIVE`,
            userPrompt: `The picture is on the page called "${p.page}".`,
            maxTokens: 60,
            attachments: [{ mediaType: pic.mediaType, data: pic.data }],
          });
          usage.inputTokens += res.usage?.inputTokens ?? 0;
          usage.outputTokens += res.usage?.outputTokens ?? 0;
          const t = clean(res.text ?? "", 160);
          if (t.length >= 6 && !/^decorative$/i.test(t)) texts[p.url] = t.replace(/^(an? )?(image|picture|photo) of /i, "");
          else skipped.push(p.page);
        } catch (err) {
          console.error("site health: could not describe a picture:", err instanceof Error ? err.message : "unknown error");
          skipped.push(p.page);
        }
      }),
    );
  }
  const credits = await bill(userId, usage);
  return { ok: true, texts, skipped, capped: pictures.length > list.length, credits };
}
