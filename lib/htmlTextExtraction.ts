import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { BRAND } from "@/lib/theme";
import { encodeAttr, encodeText } from "@/lib/editorModes/htmlSource";
/**
 * Tags whose entire subtree is never end-user-visible text — skipped outright rather than
 * enumerated per-tag, since <script>/<style>/comments already get a distinct cheerio node
 * `.type` ("script"/"style"/"comment") and are naturally excluded by only descending into
 * `type === "tag"` nodes and only collecting `type === "text"` ones. This set only needs
 * the remaining tag-typed containers whose content isn't visible page text.
 */
const SKIP_SUBTREE_TAGS = new Set(["head", "template", "svg", "noscript"]);

export type ExtractedTextNode = {
  id: number;
  /** Nearest containing tag name, e.g. "h2", "button", "a" — for debugging/grouping. */
  tag: string;
  /** Friendly, structurally-derived label — "Heading", "Button", "Menu item", etc. */
  label: string;
  /** Structural section this node lives in — "Header", "Mobile navigation", "Hero",
   * "Section 1", "Footer", etc. See sectionForAncestors() below. */
  section: string;
  /** The editable core text, trimmed. */
  text: string;
  /** Present (possibly "") only when this text sits inside an <a> — its current href, so
   * the editor can offer a link-destination field alongside the text field. Absent entirely
   * for text that isn't inside a link, so callers can gate the UI on `"href" in node`. */
  href?: string;
};

function labelFor(ancestors: string[]): string {
  const nearest = ancestors[ancestors.length - 1];
  if (nearest && /^h[1-6]$/.test(nearest)) return "Heading";
  if (ancestors.includes("button")) return "Button";
  if (ancestors.includes("a")) {
    return ancestors.includes("nav") ? "Menu item" : "Link";
  }
  if (ancestors.includes("li")) {
    return ancestors.includes("nav") ? "Menu item" : "List item";
  }
  if (ancestors.includes("th")) return "Table header";
  if (ancestors.includes("td")) return "Table cell";
  if (ancestors.includes("label")) return "Form label";
  if (ancestors.includes("figcaption")) return "Caption";
  if (ancestors.includes("blockquote")) return "Quote";
  return "Text";
}

/**
 * Tag/class/id heuristics for the handful of structural regions worth calling out by name
 * regardless of how deep a text node sits inside them — checked innermost-ancestor-first
 * (see sectionForAncestors) so e.g. a <nav> nested inside a <header> reads as "Navigation",
 * not the more generic "Header". Anything that doesn't match one of these falls back to a
 * generic "Section N" derived from document position (see computeTopLevelSections).
 */
function sectionKeywordLabel(tag: string, cls: string, idAttr: string): string | null {
  const hay = `${cls} ${idAttr}`.toLowerCase();
  if (/mobile[-_ ]?(nav|menu)|nav[-_ ]?mobile|hamburger|off[-_ ]?canvas|drawer/.test(hay)) return "Mobile navigation";
  if (tag === "nav") return "Navigation";
  if (tag === "header") return "Header";
  if (tag === "footer") return "Footer";
  if (/hero/.test(hay)) return "Hero";
  if (/footer/.test(hay)) return "Footer";
  if (/header/.test(hay)) return "Header";
  if (/^nav$|navbar|site-nav|main-nav|menu-bar/.test(hay)) return "Navigation";
  return null;
}

/**
 * Assigns a generic "Section N" label (in document order) to each direct child of the page's
 * main content container — <main> if present, else <body> itself — as a fallback for
 * whatever doesn't match a semantic sectionKeywordLabel. Using <main>'s children rather than
 * <body>'s means a typical <body><header/><main><section/><section/></main><footer/></body>
 * shell numbers the actual content sections 1, 2, 3… instead of collapsing them all into one
 * "Section 1" that happens to be the entire <main>.
 */
export function computeTopLevelSections($: cheerio.CheerioAPI, bodyRoot: AnyNode): Map<Element, string> {
  const mainChild = $(bodyRoot)
    .contents()
    .toArray()
    .find((n) => n.type === "tag" && (n as Element).name.toLowerCase() === "main");
  const containerRoot = mainChild ?? bodyRoot;

  const map = new Map<Element, string>();
  let index = 0;
  for (const node of $(containerRoot).contents().toArray()) {
    if (node.type !== "tag") continue;
    const el = node as Element;
    if (SKIP_SUBTREE_TAGS.has(el.name.toLowerCase())) continue;
    map.set(el, `Section ${++index}`);
  }
  return map;
}

export function sectionForAncestors(
  $: cheerio.CheerioAPI,
  ancestors: Element[],
  topLevelSections: Map<Element, string>,
): string {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const el = ancestors[i];
    const label = sectionKeywordLabel(el.name.toLowerCase(), $(el).attr("class") ?? "", $(el).attr("id") ?? "");
    if (label) return label;
  }
  for (const el of ancestors) {
    const label = topLevelSections.get(el);
    if (label) return label;
  }
  return "Content";
}

/**
 * Walks the same deterministic order both extractTextNodes and applyTextEdits use, so ids
 * assigned during a GET line up with what a subsequent PATCH sends back — as long as both
 * calls run against the same HTML string. visit() is called once per non-whitespace text
 * node, in document order, with the chain of actual containing elements (outermost first) —
 * not just tag names — so callers can inspect attributes (class/id/href) as well as tag.
 */
function walk(
  $: cheerio.CheerioAPI,
  root: AnyNode,
  ancestors: Element[],
  visit: (node: AnyNode, ancestors: Element[]) => void,
): void {
  const children = $(root).contents().toArray();
  for (const node of children) {
    if (node.type === "tag") {
      const el = node as Element;
      const tag = el.name.toLowerCase();
      if (SKIP_SUBTREE_TAGS.has(tag)) continue;
      walk($, el, [...ancestors, el], visit);
    } else if (node.type === "text") {
      visit(node, ancestors);
    }
  }
}

function nearestLinkAncestor(ancestors: Element[]): Element | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i].name.toLowerCase() === "a") return ancestors[i];
  }
  return undefined;
}

export function extractTextNodes(html: string): ExtractedTextNode[] {
  const $ = cheerio.load(html);
  const nodes: ExtractedTextNode[] = [];
  let id = 0;

  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  const topLevelSections = computeTopLevelSections($, root);
  walk($, root, [], (node, ancestors) => {
    const raw = (node as { data?: string }).data ?? "";
    const text = raw.trim();
    if (!text) return;
    const tagNames = ancestors.map((a) => a.name.toLowerCase());
    const linkAncestor = nearestLinkAncestor(ancestors);
    nodes.push({
      id: id++,
      tag: tagNames[tagNames.length - 1] ?? "body",
      label: labelFor(tagNames),
      section: sectionForAncestors($, ancestors, topLevelSections),
      text,
      ...(linkAncestor ? { href: $(linkAncestor).attr("href") ?? "" } : {}),
    });
  });

  return nodes;
}

/**
 * Re-parses the SAME html the ids came from and reconstructs the identical id sequence
 * (exactly like extractTextNodes/applyTextEdits), tagging each text node's nearest
 * containing element with `data-ptid` so the "Text Content" editor's live preview can
 * locate/highlight/scroll to exactly what a given field edits. Multiple text nodes can
 * share one containing element (e.g. "Some <a>link</a> text." has two plain-text runs
 * under the same <p>) — the attribute holds a space-separated list of ids rather than
 * overwriting, so `[data-ptid~="N"]` still resolves correctly for either one. Also injects
 * a highlight style block so the preview iframe can toggle `.plexo-active` without needing
 * inline styles wired through postMessage.
 */
export function annotateTextNodesForPreview(html: string): string {
  const $ = cheerio.load(html);
  let id = 0;

  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  walk($, root, [], (node, ancestors) => {
    const raw = (node as { data?: string }).data ?? "";
    const text = raw.trim();
    if (!text) return;
    const currentId = id++;
    const parent = (node as AnyNode).parent;
    if (!parent || parent.type !== "tag") return;
    const existing = $(parent).attr("data-ptid");
    $(parent).attr("data-ptid", existing ? `${existing} ${currentId}` : `${currentId}`);
  });

  // Strip every link's destination so clicking one in this preview can never navigate the
  // iframe away, no matter the click-handling timing — RawTextContentEditor's reverse
  // click-to-scroll listener also calls preventDefault, but removing href here is the one
  // guaranteed-correct fix: a browser will not navigate an <a> that has no href at all,
  // regardless of any event-handling edge case. The real href stays intact in compiledHtml
  // and the "Link URL" field — this only affects this disposable preview copy.
  $("a[href]").removeAttr("href");

  const styleTag =
    `<style>.plexo-active{outline:3px solid ${BRAND.primary} !important;outline-offset:2px;border-radius:2px;}</style>`;
  if ($("head").length > 0) {
    $("head").append(styleTag);
  } else {
    $.root().prepend(styleTag);
  }

  return $.html();
}

type Span = { startOffset: number; endOffset: number };
type Located = { sourceCodeLocation?: { startOffset: number; endOffset: number; attrs?: Record<string, Span>; startTag?: { startOffset: number; endOffset: number } } | null };

/** Replaces the given ranges of `html`, back to front so earlier positions stay valid. */
export function replaceRanges(html: string, reps: { start: number; end: number; text: string }[]): string {
  let out = html;
  for (const r of [...reps].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

/** The change that sets (or adds) one attribute, keeping the quote style it was written with. */
export function attributeRange(html: string, el: Element, name: string, value: string): { start: number; end: number; text: string } | null {
  const loc = (el as unknown as Located).sourceCodeLocation;
  if (!loc) return null;
  const escaped = encodeAttr(value, '"');
  const attr = loc.attrs?.[name];
  if (attr) {
    const raw = html.slice(attr.startOffset, attr.endOffset);
    const quote = /^[^=]*=\s*(["'])/.exec(raw)?.[1];
    const useQuote = (quote ?? '"') as '"' | "'";
    const attrName = /^[^=\s]+/.exec(raw)?.[0] ?? name;
    return { start: attr.startOffset, end: attr.endOffset, text: `${attrName}=${useQuote}${encodeAttr(value, useQuote)}${useQuote}` };
  }
  if (!loc.startTag) return null;
  const at = loc.startTag.startOffset + 1 + el.name.length;
  return { start: at, end: at, text: ` ${name}="${escaped}"` };
}

/**
 * Applies each requested text edit (and, when provided, the nearest <a> ancestor's href) to the SAME html the ids came
 * from, in the same deterministic order as extractTextNodes. Only the characters that change are rewritten: the rest of
 * the page (quotes, spacing, comments, entities, tags left open) stays exactly as it was written. Leading/trailing
 * whitespace around the original text is preserved so spacing between inline elements doesn't collapse. Ids not in
 * `edits` are left untouched, and text that comes back unchanged is not rewritten at all.
 */
export function applyTextEdits(html: string, edits: { id: number; text: string; href?: string }[]): string {
  if (edits.length === 0) return html;
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  const editById = new Map(edits.map((e) => [e.id, e]));
  const reps: { start: number; end: number; text: string }[] = [];
  const hrefByLink = new Map<Element, { start: number; end: number; text: string }>();
  let id = 0;
  let lossless = true;

  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  walk($, root, [], (node, ancestors) => {
    const textNode = node as { data?: string } & Located;
    const raw = textNode.data ?? "";
    const trimmed = raw.trim();
    if (!trimmed) return;
    const currentId = id++;
    const edit = editById.get(currentId);
    if (!edit) return;
    if (edit.text !== undefined && edit.text !== trimmed) {
      const loc = textNode.sourceCodeLocation;
      if (!loc) {
        lossless = false;
        return;
      }
      const source = html.slice(loc.startOffset, loc.endOffset);
      const lead = /^\s*/.exec(source)![0];
      const trail = /\s*$/.exec(source.slice(lead.length))![0];
      reps.push({ start: loc.startOffset, end: loc.endOffset, text: lead + encodeText(edit.text) + trail });
    }
    if (edit.href !== undefined) {
      const linkAncestor = nearestLinkAncestor(ancestors);
      if (linkAncestor && (linkAncestor.attribs?.href ?? "") !== edit.href) {
        const rep = attributeRange(html, linkAncestor, "href", edit.href);
        if (rep) hrefByLink.set(linkAncestor, rep);
        else lossless = false;
      }
    }
  });
  if (!lossless) return applyTextEditsViaTree(html, edits);
  return replaceRanges(html, [...reps, ...hrefByLink.values()]);
}

/** Fallback for the rare node the parser gave no position for: rewrites the whole page from its tree (the old way). */
function applyTextEditsViaTree(html: string, edits: { id: number; text: string; href?: string }[]): string {
  const $ = cheerio.load(html);
  const editById = new Map(edits.map((e) => [e.id, e]));
  let id = 0;

  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  walk($, root, [], (node, ancestors) => {
    const textNode = node as { data?: string };
    const raw = textNode.data ?? "";
    const trimmed = raw.trim();
    if (!trimmed) return;
    const currentId = id++;
    const edit = editById.get(currentId);
    if (!edit) return;
    if (edit.text !== undefined) {
      const leading = raw.slice(0, raw.indexOf(trimmed));
      const trailing = raw.slice(raw.indexOf(trimmed) + trimmed.length);
      textNode.data = `${leading}${edit.text}${trailing}`;
    }
    if (edit.href !== undefined) {
      const linkAncestor = nearestLinkAncestor(ancestors);
      if (linkAncestor) $(linkAncestor).attr("href", edit.href);
    }
  });

  return $.html();
}
