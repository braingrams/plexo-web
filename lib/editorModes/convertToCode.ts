/**
 * Turning a block-built page into editable code (HTML), so it can use Design | Code | Text like any page of your own code.
 *
 * What this file owns is the pure part (who may convert, what is added to the page on the way, and the check that the
 * result is the same page). The route (app/api/templates/[id]/convert-to-code) renders the blocks through the real build
 * (compileTemplateWithSiteLayout: Strata tokens, the site header/footer and the page's own "Show header/footer" switches,
 * forms, shop and blog parts, custom sections) so what becomes code is exactly what visitors get today.
 */
import { injectCustomJs } from "@/lib/pub/htmlInject";

export type ConvertRow = {
  kind?: string | null;
  sourceType?: string | null;
  isBlogLayout?: boolean | null;
  isSiteLayoutFragment?: boolean | null;
  isCommerceLayout?: boolean | null;
  isLmsPageDesign?: boolean | null;
};

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** Ordinary pages built with blocks (either editor) can become code. Emails, shared layouts and apps can't, and say why. */
export function canConvertToCode(row: ConvertRow): Eligibility {
  if (row.kind === "EMAIL") return { ok: false, reason: "Emails can't be turned into code here." };
  if (row.sourceType === "RAW_UPLOAD") return { ok: false, reason: "This page is already code." };
  if (row.sourceType === "REACT_PROJECT") return { ok: false, reason: "This is an app, so it already has its own code." };
  if (row.isBlogLayout || row.isSiteLayoutFragment || row.isCommerceLayout || row.isLmsPageDesign) {
    return { ok: false, reason: "This is a layout shared by other pages (like your header, footer, blog or shop layout), so it stays in the block editor." };
  }
  return { ok: true };
}

/**
 * The exact things a block page gets when it is SERVED but are not in its stored page: its own script (classic editor) and
 * the brand sheet (new editor). A code page isn't given those at serve time, so they are written into the code now.
 */
export function finishConvertedHtml(html: string, extras: { customJs?: string | null; classic: boolean }): { html: string; added: string[] } {
  const added: string[] = [];
  let out = html;
  const js = (extras.customJs ?? "").trim();
  if (extras.classic && js) {
    out = injectCustomJs(out, js);
    added.push(`<script>\n${js}\n</script>`);
  }
  return { html: out, added };
}

const RAW_BLOCK = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(script|style|pre|textarea)\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+|</gi;

/** One tag, written the same way whatever the quotes, spacing, attribute order or case it came with. */
function normalizeTag(tag: string): string {
  const m = /^<(\/?)([a-zA-Z][^\s/>]*)([\s\S]*?)(\/?)>$/.exec(tag);
  if (!m) return tag;
  const [, slash, name, rest] = m;
  const attrs: string[] = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(rest)) !== null) {
    const value = a[2] ?? a[3] ?? a[4];
    attrs.push(value === undefined ? a[1].toLowerCase() : `${a[1].toLowerCase()}="${value.replace(/\s+/g, " ").trim()}"`);
  }
  attrs.sort();
  return `<${slash}${name.toLowerCase()}${attrs.length ? " " + attrs.join(" ") : ""}>`;
}

/**
 * The page, boiled down to what a visitor could tell apart: comments gone, spacing between tags ignored, quotes,
 * attribute order and tag case ignored. Code inside <script>/<style>/<pre> is kept as written (trimmed). Two pages with the
 * same normalised text look and behave the same.
 */
export function normalizeHtml(html: string): string {
  return normalizeParts(html).join("\n");
}

const INLINE_TAGS = new Set(["a", "abbr", "b", "bdi", "bdo", "button", "cite", "code", "data", "del", "dfn", "em", "i", "img", "input", "ins", "kbd", "label", "mark", "q", "s", "samp", "select", "small", "span", "strong", "sub", "sup", "time", "u", "var", "br", "wbr", "svg", "path", "option", "textarea"]);

/** Spaces next to a block-level tag never show (the browser drops them), so they are not a difference. */
function trimAtBlockEdges(parts: string[]): string[] {
  const block = (part: string | undefined): boolean => {
    const m = part ? /^<\/?([a-z][a-z0-9-]*)/.exec(part) : null;
    return !!m && !INLINE_TAGS.has(m[1]);
  };
  const out: string[] = [];
  parts.forEach((part, i) => {
    if (part.startsWith("<") || part.startsWith("!")) return void out.push(part);
    let t = part;
    if (i === 0 || block(parts[i - 1])) t = t.replace(/^\s+/, "");
    if (i === parts.length - 1 || block(parts[i + 1])) t = t.replace(/\s+$/, "");
    if (t) out.push(t);
  });
  return out;
}

function normalizeParts(html: string): string[] {
  return trimAtBlockEdges(rawParts(html));
}

function rawParts(html: string): string[] {
  const parts: string[] = [];
  for (const m of html.matchAll(RAW_BLOCK)) {
    const tok = m[0];
    if (tok.startsWith("<!--")) continue;
    if (/^<!doctype/i.test(tok)) {
      parts.push(tok.toLowerCase().replace(/\s+/g, " "));
      continue;
    }
    if (m[1]) {
      const name = m[1].toLowerCase();
      const open = /^<(?:"[^"]*"|'[^']*'|[^>"'])*>/.exec(tok)![0];
      const inner = tok.slice(open.length, tok.toLowerCase().lastIndexOf(`</${name}`));
      parts.push(normalizeTag(open) + (name === "pre" || name === "textarea" ? inner : inner.trim()) + `</${name}>`);
    } else if (tok.startsWith("<") && tok.length > 1 && /^<\/?[a-zA-Z]/.test(tok)) {
      parts.push(normalizeTag(tok));
    } else if (!tok.startsWith("<")) {
      const text = tok.replace(/\s+/g, " ");
      if (text.trim()) parts.push(text);
    } else parts.push(tok);
  }
  return parts;
}

/**
 * True when `after` is `before` plus only the pieces that were meant to be added (`added`), as a visitor would see it.
 * This is the safety net the conversion runs before it saves anything: if it fails, the page is left as it was.
 */
export function samePageWithAdditions(before: string, after: string, added: string[] = []): boolean {
  const parts = normalizeParts(after);
  for (const piece of added) {
    const p = normalizeParts(piece);
    let at = -1;
    for (let i = parts.length - p.length; i >= 0; i--) {
      if (p.every((x, k) => parts[i + k] === x)) {
        at = i;
        break;
      }
    }
    if (at === -1 || p.length === 0) return false;
    parts.splice(at, p.length);
  }
  const was = normalizeParts(before);
  return parts.length === was.length && parts.every((x, i) => x === was[i]);
}

/** Wording for the dialog: what will be copied across, in plain words. */
export type ConvertNotes = { copied: string[]; heads: string[] };

export function describeConvert(input: { hasHeader: boolean; hasFooter: boolean; hasUnpublishedChanges: boolean; isLive: boolean; hasOwnScript: boolean }): ConvertNotes {
  const copied: string[] = ["Your words, pictures, colours and fonts."];
  if (input.hasHeader || input.hasFooter) {
    copied.push(`Your site's ${input.hasHeader && input.hasFooter ? "header and footer" : input.hasHeader ? "header" : "footer"}, as they are today.`);
  }
  copied.push("Forms, shop, blog and other ready-made parts keep working.");
  if (input.hasOwnScript) copied.push("The script you added to this page.");
  const heads: string[] = [];
  if (input.hasHeader || input.hasFooter) {
    heads.push("The header and footer are copied into this page. If you change them on the site later, this page keeps the old ones until you change them here.");
  }
  if (input.isLive) heads.push("Pages made of code don't have a separate draft: when you save a change, it goes live straight away.");
  return { copied, heads };
}

export type SourceChoice = { value: "working" | "live"; label: string; help: string };

/**
 * A page made of code has no separate draft. If the owner has changes they haven't published AND the page is live, they
 * choose which version becomes the code; otherwise there is nothing to choose (an unpublished page just uses the latest).
 */
export function sourceChoices(input: { hasUnpublishedChanges: boolean; isLive: boolean }): { ask: boolean; options: SourceChoice[] } {
  if (!input.hasUnpublishedChanges || !input.isLive) return { ask: false, options: [] };
  return {
    ask: true,
    options: [
      { value: "working", label: "My latest changes", help: "What you see in the editor now. Visitors will see these straight away, because code pages have no draft." },
      { value: "live", label: "What visitors see now", help: "Your newer changes aren't lost: they stay in the backup, and come back if you go back to blocks." },
    ],
  };
}

/** Where to go once the page is code: the view the owner asked for. */
export const afterConvertHref = (templateId: string, view: "code" | "text"): string => `/dashboard/templates/${templateId}?mode=${view}`;
