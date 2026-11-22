import { escapeHtmlAttr, safeJsonLd } from "@/lib/pub/htmlInject";
import { hasBothSizes, originalImageUrl, type Size } from "./imageSize";

/**
 * The extra "Fix it for me" options. Every one is a pure function of the page's HTML: it only ever ADDS a missing
 * piece (or tightens something already there), never overwrites what the owner wrote, and running it twice changes
 * nothing. Each returns plain-words notes of what it did, which the preview shows.
 */

export type Step = { html: string; notes: string[] };
export type StepCtx = {
  canonicalUrl: string;
  siteName: string;
  /** Remembered picture sizes by picture address (lib/siteHealth/imageSize.ts). */
  sizes?: Map<string, Size>;
  /** A title written once and stored for this page (the owner may have edited it). */
  storedTitle?: string | null;
};

const unchanged = (html: string): Step => ({ html, notes: [] });
const headEndIndex = (html: string) => html.search(/<\/head\s*>/i);
export const headOf = (html: string) => {
  const i = headEndIndex(html);
  return i === -1 ? html.slice(0, 20000) : html.slice(0, i);
};

function addToHead(html: string, tags: string): string {
  const m = html.match(/<head[^>]*>/i);
  return m && m.index !== undefined ? html.slice(0, m.index + m[0].length) + tags + html.slice(m.index + m[0].length) : tags + html;
}

const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2, 4).find((v) => v !== undefined);
const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/** Body without scripts and styles: what a reader (or a crawler) sees as text. */
const bodyText = (html: string) => html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ");

// ─── Speed ───────────────────────────────────────────────────────────────────

/** The first big picture is what visitors wait for: load it first, never lazily. */
export function heroImage(html: string): Step {
  const bodyAt = html.search(/<body\b/i);
  const from = bodyAt === -1 ? 0 : bodyAt;
  const re = /<img\b([^>]*)>/i;
  const rest = html.slice(from);
  const m = rest.match(re);
  if (!m || m.index === undefined) return unchanged(html);
  const attrs = m[1];
  const src = attrOf(`<img ${attrs}>`, "src");
  // Tiny inline icons and tracking pixels are not heroes.
  if (!src || /^data:/i.test(src) || /\b(width|height)\s*=\s*["']?(1|2|3|4|8|16|24|32)["']?\s/i.test(`${attrs} `)) return unchanged(html);
  const notes: string[] = [];
  let newAttrs = attrs;
  if (!/\bfetchpriority\s*=/i.test(newAttrs)) {
    newAttrs = ` fetchpriority="high"${newAttrs.startsWith(" ") ? "" : " "}${newAttrs}`;
    notes.push("Your main picture loads first.");
  }
  if (/\bloading\s*=\s*["']lazy["']/i.test(newAttrs)) {
    newAttrs = newAttrs.replace(/\s*\bloading\s*=\s*["']lazy["']/i, "");
    notes.push("Your main picture no longer waits to be scrolled to.");
  }
  let out = html;
  if (newAttrs !== attrs) out = html.slice(0, from + m.index) + `<img${newAttrs}>` + html.slice(from + m.index + m[0].length);
  const head = headOf(out);
  const hasSrcset = /\bsrcset\s*=/i.test(attrs);
  const preloaded = [...head.matchAll(/<link\b[^>]*>/gi)].some((m) => /rel=["']preload["']/i.test(m[0]) && (m[0].includes(escapeHtmlAttr(src)) || m[0].includes(src)));
  if (!preloaded && !hasSrcset && /^(\/|https:\/\/)/.test(src)) {
    out = addToHead(out, `<link rel="preload" as="image" href="${escapeHtmlAttr(src)}" fetchpriority="high">`);
    notes.push("The browser starts fetching it before the rest of the page.");
  }
  return notes.length ? { html: out, notes } : unchanged(html);
}

/** Web fonts: show text straight away (font-display: swap) and open the connection to the font host early. */
export function fastFonts(html: string): Step {
  const notes: string[] = [];
  let out = html;
  const gf = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi;
  let patched = 0;
  out = out.replace(gf, (url) => {
    if (/[?&]display=/.test(url)) return url;
    patched++;
    return `${url}&display=swap`;
  });
  if (patched) notes.push(`Text appears while ${patched === 1 ? "your font" : "your fonts"} load${patched === 1 ? "s" : ""}, instead of staying invisible.`);
  let blocks = 0;
  out = out.replace(/@font-face\s*\{([^}]*)\}/gi, (full, body: string) => {
    if (/font-display\s*:/i.test(body)) return full;
    blocks++;
    return full.replace("{", "{font-display:swap;");
  });
  if (blocks) notes.push("Text appears while your own font files load.");
  if (/fonts\.googleapis\.com/i.test(out)) {
    const head = headOf(out);
    let tags = "";
    if (!/rel=["']preconnect["'][^>]*href=["']https:\/\/fonts\.googleapis\.com/i.test(head) && !/href=["']https:\/\/fonts\.googleapis\.com["'][^>]*rel=["']preconnect["']/i.test(head)) tags += `<link rel="preconnect" href="https://fonts.googleapis.com">`;
    if (/fonts\.gstatic\.com/i.test(out) || /fonts\.googleapis\.com\/css/i.test(out)) {
      if (!/fonts\.gstatic\.com["'][^>]*>/i.test(head) || !/preconnect[^>]*fonts\.gstatic\.com|fonts\.gstatic\.com[^>]*preconnect/i.test(head)) tags += `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`;
    }
    if (tags) {
      out = addToHead(out, tags);
      notes.push("The browser opens the connection to your font provider early.");
    }
  }
  return notes.length ? { html: out, notes } : unchanged(html);
}

const PROTECTED = /(<(script|style|pre|textarea)\b[\s\S]*?<\/\2\s*>)/gi;

/** Smaller pages open faster: drop comments and blank space between tags. Scripts, preformatted text and styles with strings are left alone. */
export function smallerHtml(html: string): Step {
  const parts = html.split(PROTECTED);
  // split with two capture groups yields [text, whole, tagname, text, ...]
  let out = "";
  for (let i = 0; i < parts.length; i += 3) {
    let text = parts[i] ?? "";
    text = text.replace(/<!--(?!\[if|<!|\s*\/?noindex)[\s\S]*?-->/gi, "");
    text = text.replace(/>([^<]+)</g, (_m, t: string) => (/\S/.test(t) ? `>${t.replace(/\s+/g, " ")}<` : `> <`));
    out += text;
    if (parts[i + 1]) {
      const block = parts[i + 1];
      const tag = (parts[i + 2] ?? "").toLowerCase();
      out += tag === "style" && !/content\s*:|url\(\s*["']?data:|["']/i.test(block) ? block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};:,>])\s*/g, "$1") : block;
    }
  }
  // Never trade correctness for bytes: if it did not shrink meaningfully, serve the original.
  if (out.length >= html.length * 0.99) return unchanged(html);
  const saved = html.length - out.length;
  return { html: out, notes: [`Your pages get about ${Math.max(1, Math.round(saved / 1024))} KB smaller.`] };
}

// ─── Search and sharing ──────────────────────────────────────────────────────

const firstHeading = (html: string) => {
  const m = bodyText(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : "";
};

/** A page with no (or an empty) title: make one from the main heading and the site's name. */
export function pageTitle(html: string, ctx: StepCtx): Step {
  const head = headOf(html);
  const existing = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (existing && stripTags(existing[1]).length >= 3) return unchanged(html);
  const h1 = firstHeading(html);
  const name = ctx.siteName.trim();
  // A title written for this page when the fix was switched on wins over one built from the heading.
  let title = ctx.storedTitle?.trim() || (h1 && name && !h1.toLowerCase().includes(name.toLowerCase()) ? `${h1} | ${name}` : h1 || name);
  if (!title) return unchanged(html);
  if (title.length > 65) title = `${title.slice(0, 62).trimEnd()}…`;
  const tag = `<title>${escapeHtmlAttr(title)}</title>`;
  const out = existing ? html.replace(existing[0], tag) : addToHead(html, tag);
  return { html: out, notes: [`Your page's name in the browser tab and in Google becomes "${title}".`] };
}

/** The preview that appears when someone shares a link (Facebook, WhatsApp, LinkedIn, X...). Only adds what is missing. */
export function socialTags(html: string, ctx: StepCtx): Step {
  const head = headOf(html);
  const has = (key: string) => new RegExp(`<meta\\b[^>]*(?:property|name)=["']${key}["']`, "i").test(head);
  const title = stripTags(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || firstHeading(html) || ctx.siteName;
  const descTag = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name=["']description["']/i.test(t));
  const description = descTag ? attrOf(descTag, "content")?.trim() ?? "" : "";
  const imgTag = bodyText(html).match(/<img\b[^>]*>/i)?.[0];
  const rawSrc = imgTag ? attrOf(imgTag, "src") : undefined;
  let image: string | null = null;
  if (rawSrc && !/^data:/i.test(rawSrc)) {
    try {
      image = new URL(rawSrc, ctx.canonicalUrl).toString();
    } catch {
      image = null;
    }
  }
  const tags: string[] = [];
  const add = (key: string, value: string | null | undefined, attr: "property" | "name" = "property") => {
    if (value && !has(key)) tags.push(`<meta ${attr}="${key}" content="${escapeHtmlAttr(value)}">`);
  };
  add("og:title", title);
  add("og:type", "website");
  add("og:url", ctx.canonicalUrl);
  add("og:site_name", ctx.siteName);
  add("og:description", description || null);
  add("og:image", image);
  add("twitter:card", image ? "summary_large_image" : "summary", "name");
  add("twitter:title", title, "name");
  add("twitter:description", description || null, "name");
  add("twitter:image", image, "name");
  if (!tags.length) return unchanged(html);
  return { html: addToHead(html, tags.join("")), notes: ["Shared links show your name, summary and a picture instead of a bare address."] };
}

/** Pairs of question + answer found on the page: <details><summary>, or a heading ending in "?" followed by a paragraph. */
export function findQuestions(html: string): { q: string; a: string }[] {
  const body = bodyText(html);
  const out: { q: string; a: string }[] = [];
  for (const m of body.matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)) {
    const q = stripTags(m[1]);
    const a = stripTags(m[2]);
    if (q && a) out.push({ q, a });
  }
  for (const m of body.matchAll(/<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>\s*<(p|div)\b[^>]*>([\s\S]*?)<\/\3>/gi)) {
    const q = stripTags(m[2]);
    const a = stripTags(m[4]);
    if (q.endsWith("?") && a) out.push({ q, a });
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.q) ? false : (seen.add(x.q), true))).slice(0, 20);
}

/** Labels questions and answers so search and AI tools can quote them. Needs at least two real pairs. */
export function faqSchema(html: string): Step {
  if (/"@type"\s*:\s*"FAQPage"/i.test(html)) return unchanged(html);
  const qa = findQuestions(html);
  if (qa.length < 2) return unchanged(html);
  const json = safeJsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a.slice(0, 600) } })) });
  return { html: addToHead(html, `<script type="application/ld+json">${json}</script>`), notes: [`${qa.length} questions on your page are labelled so Google and AI assistants can quote the answers.`] };
}

/** Lines for robots.txt that say, out loud, that AI assistants are welcome. */
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"];
export function aiRobotsRules(): string {
  return `${AI_CRAWLERS.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}`;
}

// ─── Layout shift ────────────────────────────────────────────────────────────

const SIZED_RULE = `<style data-plexo-sized>:where(img[data-plexo-sized]){height:auto}</style>`;

/**
 * Gives pictures their real width and height so the page reserves their space before they arrive (no jumping).
 * Sizes come from what we remembered about each picture (read from the file when it was uploaded, or looked up once),
 * never fetched while serving. A picture that already has a width and a height is left alone, and so is one whose size we
 * do not know. The small rule added to the page keeps the height proportional (it loses to any height the owner's own
 * styles set), so a picture that is made narrower on a phone is never stretched.
 */
export function imageSizes(html: string, ctx: StepCtx): Step {
  const sizes = ctx.sizes;
  if (!sizes || !sizes.size) return unchanged(html);
  let added = 0;
  const out = html.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
    if (hasBothSizes(attrs) || /\bwidth\s*=|\bheight\s*=/i.test(attrs) || /data-plexo-sized/.test(attrs)) return full;
    const src = attrs.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1];
    const url = src ? originalImageUrl(src, ctx.canonicalUrl) : null;
    const size = url ? sizes.get(url) : undefined;
    if (!size) return full;
    added++;
    let next = attrs.replace(/\s*\/\s*$/, "");
    const style = next.match(/\bstyle\s*=\s*"([^"]*)"/i);
    const ratio = `aspect-ratio:${size.width}/${size.height}`;
    if (style) next = /aspect-ratio\s*:/i.test(style[1]) ? next : next.replace(style[0], `style="${style[1].replace(/;?\s*$/, ";")}${ratio}"`);
    else next += ` style="${ratio}"`;
    return `<img width="${size.width}" height="${size.height}" data-plexo-sized${next.startsWith(" ") ? "" : " "}${next}>`;
  });
  if (!added) return unchanged(html);
  const withRule = html.includes("<style data-plexo-sized") ? out : addToHead(out, SIZED_RULE);
  return { html: withRule, notes: [`${added} ${added === 1 ? "picture reserves" : "pictures reserve"} its space before it loads, so your page stops jumping around.`] };
}
