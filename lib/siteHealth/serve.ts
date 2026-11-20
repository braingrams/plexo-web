import { SiteHealthSettings } from "@/lib/db/opsEntities";
import { escapeHtmlAttr, safeJsonLd } from "@/lib/pub/htmlInject";
import { EXTRA_FIX_IDS, type ExtraFixId, type HealthSettingsView } from "./types";
import { faqSchema, fastFonts, heroImage, imageSizes, pageTitle, smallerHtml, socialTags, type Step } from "./speedFixes";
import { cleanBusiness, organizationJsonLd } from "./businessMarkup";
import { imagesNeedingSize, originalImageUrl, sizesFor, type Size } from "./imageSize";

/**
 * The "Fix it for me" options, applied while a page is served. Nothing in the owner's pages is
 * rewritten, so turning an option off puts the page back exactly as it was.
 */

export const NO_SETTINGS: HealthSettingsView = { extras: {}, fallbackDescription: null, llmsTxt: false, organizationSchema: false, lazyEmbeds: false, altFromFilename: false, language: null, business: null, aiTitles: {}, aiAlts: {}, emailDigest: true };

const textMap = (v: unknown, max: number): Record<string, string> => {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 200)) if (typeof val === "string" && val.trim()) out[k] = val.slice(0, max);
  return out;
};

export function toView(row: { fallbackDescription?: string; llmsTxt?: boolean; organizationSchema?: boolean; lazyEmbeds?: boolean; altFromFilename?: boolean; language?: string; extras?: unknown; business?: unknown; aiTitles?: unknown; aiAlts?: unknown; digestOff?: boolean } | null | undefined): HealthSettingsView {
  if (!row) return NO_SETTINGS;
  const raw = row.extras && typeof row.extras === "object" ? (row.extras as Record<string, unknown>) : {};
  const extras: HealthSettingsView["extras"] = {};
  for (const id of EXTRA_FIX_IDS) if (raw[id] === true) extras[id] = true;
  return {
    extras, fallbackDescription: row.fallbackDescription ?? null, llmsTxt: !!row.llmsTxt, organizationSchema: !!row.organizationSchema, lazyEmbeds: !!row.lazyEmbeds, altFromFilename: !!row.altFromFilename, language: row.language ?? null,
    business: row.business && typeof row.business === "object" ? cleanBusiness(row.business) : null,
    aiTitles: textMap(row.aiTitles, 120),
    aiAlts: textMap(row.aiAlts, 300),
    emailDigest: !row.digestOff,
  };
}

const TTL_MS = 60_000;
const cache = new Map<string, { view: HealthSettingsView; at: number }>();

export function forgetHealthSettings(templateId: string): void {
  cache.delete(templateId);
}

/** Looked up on every page view, so remembered for a minute per server. Failure means "no options", never a broken page. */
export async function healthSettingsFor(templateId: string): Promise<HealthSettingsView> {
  const hit = cache.get(templateId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.view;
  try {
    const { data } = await SiteHealthSettings.get({ templateId }).go();
    const view = toView(data);
    cache.set(templateId, { view, at: Date.now() });
    return view;
  } catch {
    return NO_SETTINGS;
  }
}

const GENERIC_NAMES = /^(image|images|img|photo|photos|picture|pictures|pic|untitled|screenshot|download|file|banner|logo|icon)( \d+)?$/i;

/** "hero-photo_2.jpg" becomes "Hero photo 2"; a hashed, numeric or generic name gives nothing (no guessing). */
export function altFromSrc(src: string): string | null {
  let file = "";
  try {
    const u = new URL(src, "https://x.invalid");
    // Pictures served through Plexo's resizer keep their real file name in the url= part.
    const inner = u.pathname === "/_next/image" ? u.searchParams.get("url") : null;
    file = decodeURIComponent((inner ? new URL(inner, "https://x.invalid").pathname : u.pathname).split("/").pop() ?? "");
  } catch {
    return null;
  }
  const base = file.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_.]+/g, " ").replace(/\b\d{3,}x\d{3,}\b/g, " ").replace(/\s+/g, " ").trim();
  const letters = base.replace(/[^a-z]/gi, "");
  if (letters.length < 4 || GENERIC_NAMES.test(base) || /^[0-9a-f ]{12,}$/i.test(base) || !/[aeiou]/i.test(letters)) return null;
  const words = base.split(" ").slice(0, 8).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function headRange(html: string): { start: number; end: number } | null {
  const m = html.match(/<head[^>]*>/i);
  return m && m.index !== undefined ? { start: m.index + m[0].length, end: m.index + m[0].length } : null;
}

function addToHead(html: string, tags: string): string {
  const h = headRange(html);
  return h ? html.slice(0, h.start) + tags + html.slice(h.end) : tags + html;
}

/** What serving a page needs besides the settings: the address, the site's name and remembered picture sizes. */
export type ServeCtx = { canonicalUrl: string; siteName: string; sizes?: Map<string, Size> };

/** The remembered picture sizes for this page, read only when the "stop the page jumping" fix is on. */
export async function serveCtxFor(html: string, s: HealthSettingsView, base: { canonicalUrl: string; siteName: string }): Promise<ServeCtx> {
  if (!s.extras.image_sizes) return base;
  return { ...base, sizes: await sizesFor(imagesNeedingSize(html, base.canonicalUrl)) };
}

export function applyHealthSettings(html: string, s: HealthSettingsView, ctx: ServeCtx): string {
  return applyHealthSettingsWithNotes(html, s, ctx).html;
}

/** Same as applyHealthSettings, plus a plain-words list of what changed per fix (for the preview). */
export function applyHealthSettingsWithNotes(html: string, s: HealthSettingsView, ctx: ServeCtx): { html: string; notes: Partial<Record<string, string[]>> } {
  const notes: Partial<Record<string, string[]>> = {};
  const note = (id: string, n: string[]) => {
    if (n.length) notes[id] = n;
  };
  let out = html;
  const headEnd = out.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? out.slice(0, 20000) : out.slice(0, headEnd);

  if (s.language && !/<html\b[^>]*\blang=/i.test(out)) {
    out = /<html\b/i.test(out) ? out.replace(/<html\b/i, `<html lang="${escapeHtmlAttr(s.language)}"`) : out;
    note("language", [`Your page says it is written in "${s.language}".`]);
  }

  let tags = "";
  const hasDescription = /<meta\b[^>]*name=["']description["']/i.test(head);
  if (s.fallbackDescription && !hasDescription) {
    const d = escapeHtmlAttr(s.fallbackDescription);
    tags += `<meta name="description" content="${d}">`;
    if (!/property=["']og:description["']/i.test(head)) tags += `<meta property="og:description" content="${d}">`;
    note("meta_description", [`Google shows: "${s.fallbackDescription}"`]);
  }
  if (s.organizationSchema && !/"@type"\s*:\s*"(Organization|LocalBusiness)"/i.test(out)) {
    // Built from the details the owner confirmed (name, logo, phone, address, hours, social profiles); a site with none still gets its name and address.
    const business = s.business ?? {};
    const ld = organizationJsonLd(business, { siteName: ctx.siteName, origin: new URL(ctx.canonicalUrl).origin, description: s.fallbackDescription });
    tags += `<script type="application/ld+json">${safeJsonLd(ld)}</script>`;
    const kind = ld["@type"] === "LocalBusiness" ? "a local business at your address" : "a business";
    note("organization_schema", [`Search tools learn you are ${kind} called "${ld.name as string}"${ld.telephone ? ", how to call you" : ""}${ld.address ? ", where to find you" : ""}${ld.openingHoursSpecification ? " and when you are open" : ""}.`]);
  }
  if (tags) out = addToHead(out, tags);

  if (s.altFromFilename) {
    const altNotes: string[] = [];
    const written = s.aiAlts ?? {};
    out = out.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
      const alt = attrs.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
      if ((alt && (alt[2] ?? alt[3] ?? "").trim()) || /\brole=["']presentation["']/i.test(attrs)) return full;
      const src = attrs.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1];
      // A description written for this picture (and maybe edited by the owner) wins over one built from its file name.
      const original = src ? originalImageUrl(src, ctx.canonicalUrl) : null;
      const text = (original && written[original]) || (src ? altFromSrc(src) : null);
      if (!text) return full;
      altNotes.push(`"${text}"`);
      return alt ? full.replace(alt[0], `alt="${escapeHtmlAttr(text)}"`) : `<img alt="${escapeHtmlAttr(text)}"${attrs.startsWith(" ") ? "" : " "}${attrs}>`;
    });
    if (altNotes.length) note("alt_text", [`${altNotes.length} ${altNotes.length === 1 ? "picture gets" : "pictures get"} a description: ${altNotes.slice(0, 3).join(", ")}${altNotes.length > 3 ? "…" : ""}`]);
  }

  if (s.lazyEmbeds) {
    let seen = 0;
    out = out.replace(/<iframe\b([^>]*)>/gi, (full, attrs: string) => {
      seen++;
      // The first embed may be the main thing on the page; leave it loading straight away.
      if (seen === 1 || /\bloading=/i.test(attrs)) return full;
      return `<iframe loading="lazy"${attrs.startsWith(" ") ? "" : " "}${attrs}>`;
    });
    out = out.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => (/\bdecoding=/i.test(attrs) ? full : `<img decoding="async"${attrs.startsWith(" ") ? "" : " "}${attrs}>`));
    note("lazy_embeds", [seen > 1 ? `${seen - 1} videos or maps wait until someone scrolls to them.` : "Pictures are drawn without holding up the page."]);
  }

  // The extra fixes. Order matters a little: titles and summaries first so sharing tags can reuse them, size last.
  const run = (id: ExtraFixId, step: (h: string) => Step) => {
    if (!s.extras[id]) return;
    const r = step(out);
    out = r.html;
    note(id, r.notes);
  };
  let path = "/";
  try {
    path = new URL(ctx.canonicalUrl).pathname || "/";
  } catch {
    // keep "/"
  }
  const storedTitle = s.aiTitles?.[path] ?? s.aiTitles?.[path.replace(/\/$/, "") || "/"] ?? null;
  run("page_title", (h) => pageTitle(h, { ...ctx, storedTitle }));
  run("image_sizes", (h) => imageSizes(h, ctx));
  run("hero_image", heroImage);
  run("fast_fonts", fastFonts);
  run("social_tags", (h) => socialTags(h, ctx));
  run("faq_schema", faqSchema);
  run("smaller_html", smallerHtml);
  return { html: out, notes };
}

/** The plain-text file for AI tools (/llms.txt): who the site is, in one line, and where the pages are. */
export function buildLlmsTxt(input: { siteName: string; description: string | null; pages: { loc: string; name?: string }[] }): string {
  const lines = [`# ${input.siteName}`, ""];
  if (input.description) lines.push(`> ${input.description}`, "");
  lines.push("## Pages", "");
  for (const p of input.pages.slice(0, 200)) lines.push(`- [${(p.name || p.loc).replace(/[\[\]]/g, "")}](${p.loc})`);
  return `${lines.join("\n")}\n`;
}
