import { extractImageNodes } from "@/lib/htmlImageExtraction";
import { extractTextNodes } from "@/lib/htmlTextExtraction";
import type { ElementPointer } from "./types";

/**
 * "Open the editor" that lands on the exact thing, not just the editor.
 *
 * Google (and our own scan) point at an element by its markup. This finds the same element in what the owner edits, and
 * returns the address parameters the editors understand:
 *   focus=<element id>   visual editors (new and classic): scrolls to the element and highlights it
 *   line=<n>             Code view: puts the cursor on that line
 *   field=<kind>-<n>     Text view: opens that text, picture or background field and highlights it on the page
 * Nothing is guessed: when the element cannot be found there is simply no parameter and the editor opens normally.
 */

export type PageForLinks = {
  /** "RAW_UPLOAD" pages are edited as HTML (Design, Code, Text views); everything else is a block page. */
  sourceType?: string | null;
  /** The page's HTML as stored (what the Code and Text views show). */
  html: string;
  /** The page's design (new or classic editor), when it is a block page. */
  design?: unknown;
};

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2, 4).find((v) => v !== undefined);

export type Tokens = { src?: string; href?: string; text?: string };

/** What identifies the element in the owner's own page: its picture address, link address or words. */
export function tokensOf(pointer: ElementPointer): Tokens {
  const snippet = pointer.snippet || "";
  const open = snippet.match(/<[a-z][^>]*>?/i)?.[0] ?? "";
  let src = attrOf(open, "src");
  // A picture served through Plexo's resizer keeps the real address in url=.
  if (src && /\/_next\/image\?/.test(src)) {
    try {
      src = new URL(src, "https://x.invalid").searchParams.get("url") ?? src;
    } catch {
      // keep as is
    }
  }
  const href = attrOf(open, "href");
  const text = stripTags(snippet.replace(/<[^>]*$/, "")).replace(/…|\.\.\.$/, "").trim();
  return { src: src || undefined, href: href && !href.startsWith("#") && href !== "/" ? href : undefined, text: text.length >= 3 ? text : undefined };
}

const CHILD_KEYS = new Set(["children", "rows", "columns", "contents", "pages", "sections", "blocks", "items"]);

function ownStrings(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (typeof v === "string") out.push(v);
    else if (depth < 4 && v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!CHILD_KEYS.has(k)) walk(x, depth + 1);
    else if (depth < 4 && Array.isArray(v) && v.length <= 12) for (const x of v) walk(x, depth + 1);
  };
  for (const [k, v] of Object.entries(node)) if (k !== "id" && !CHILD_KEYS.has(k)) walk(v, 0);
  return out;
}

/** The id of the element in a design (new or classic editor) that holds this picture, link or text. Null when none does. */
export function findDesignNodeId(design: unknown, t: Tokens): string | null {
  if (!t.src && !t.href && !t.text) return null;
  const matches = (value: string) => {
    const v = value.trim();
    if (!v) return false;
    const plain = v.includes("<") ? stripTags(v) : v;
    return (!!t.src && (v === t.src || v.endsWith(t.src) || t.src.endsWith(v) && v.length > 12)) || (!!t.href && v === t.href) || (!!t.text && (plain === t.text || (t.text.length >= 8 && plain.includes(t.text))));
  };
  let found: string | null = null;
  const visit = (node: unknown, depth: number): void => {
    if (found || depth > 40 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.id === "string" && ownStrings(obj).some(matches)) {
      found = obj.id;
      return;
    }
    for (const k of Object.keys(obj)) visit(obj[k], depth + 1);
  };
  visit(design, 0);
  return found;
}

/** The 1-based line in the page's HTML where this element starts. Null when it is not there. */
export function findSourceLine(source: string, t: Tokens): number | null {
  const needles: string[] = [];
  if (t.src) needles.push(t.src);
  if (t.href) needles.push(t.href);
  if (t.text) needles.push(t.text.slice(0, 60));
  for (const n of needles) {
    const at = source.indexOf(n);
    if (at !== -1) return source.slice(0, at).split("\n").length;
  }
  return null;
}

/** The Text view field for this element: a picture, or words (matched on what they say). */
export function findTextField(source: string, t: Tokens): string | null {
  try {
    if (t.src) {
      const img = extractImageNodes(source).find((n) => n.src === t.src || n.src.endsWith(t.src!) || t.src!.endsWith(n.src));
      if (img) return `${img.kind === "img" ? "img" : "background"}-${img.id}`;
    }
    if (t.text || t.href) {
      const text = extractTextNodes(source).find((n) => (t.text && (n.text === t.text || (t.text.length >= 8 && n.text.includes(t.text)))) || (t.href && n.href === t.href));
      if (text) return `text-${text.id}`;
    }
  } catch {
    // an unreadable page: no field
  }
  return null;
}

export type EditorQueries = { editor?: string; code?: string };

/** The address parameters for one pointed-at element. `editor` is the friendliest place to fix it; `code` is the line in Code view (HTML pages only). */
export function editorQueriesFor(page: PageForLinks, pointer: ElementPointer): EditorQueries {
  const t = tokensOf(pointer);
  if (page.sourceType === "RAW_UPLOAD") {
    const out: EditorQueries = {};
    const field = findTextField(page.html, t);
    if (field) out.editor = `mode=text&field=${field}`;
    const line = findSourceLine(page.html, t);
    if (line) {
      out.code = `mode=code&line=${line}`;
      if (!out.editor) out.editor = out.code;
    }
    return out;
  }
  const id = findDesignNodeId(page.design, t);
  return id ? { editor: `focus=${encodeURIComponent(id)}` } : {};
}

/** First picture with no description: where the "describe my pictures" fix would start. Used when Google did not point at anything. */
export function firstUndescribedPicture(html: string): ElementPointer | null {
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = attrOf(m[0], "alt");
    if ((alt ?? "").trim() || /\brole=["']presentation["']/i.test(m[0])) continue;
    if (!attrOf(m[0], "src") || /^data:/i.test(attrOf(m[0], "src")!)) continue;
    return { selector: "img", snippet: m[0].slice(0, 300), label: "Picture without a description" };
  }
  return null;
}

/** What the editors will show for this site's home page. A page with unpublished edits opens on those, so they are what to look in. */
export function pageForLinks(site: { sourceType?: string | null; compiledHtml: string; designJson?: unknown; draftJson?: unknown; draftHtml?: string | null }): PageForLinks {
  return { sourceType: site.sourceType, html: site.sourceType === "RAW_UPLOAD" ? site.compiledHtml : site.draftHtml || site.compiledHtml, design: site.draftJson ?? site.designJson };
}
