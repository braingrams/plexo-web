import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

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
  /** The editable core text, trimmed. */
  text: string;
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
 * Walks the same deterministic order both extractTextNodes and applyTextEdits use, so ids
 * assigned during a GET line up with what a subsequent PATCH sends back — as long as both
 * calls run against the same HTML string. visit() is called once per non-whitespace text
 * node, in document order, with its containing element's tag chain.
 */
function walk(
  $: cheerio.CheerioAPI,
  root: AnyNode,
  ancestors: string[],
  visit: (node: AnyNode, ancestors: string[]) => void,
): void {
  const children = $(root).contents().toArray();
  for (const node of children) {
    if (node.type === "tag") {
      const el = node as Element;
      const tag = el.name.toLowerCase();
      if (SKIP_SUBTREE_TAGS.has(tag)) continue;
      walk($, el, [...ancestors, tag], visit);
    } else if (node.type === "text") {
      visit(node, ancestors);
    }
  }
}

export function extractTextNodes(html: string): ExtractedTextNode[] {
  const $ = cheerio.load(html);
  const nodes: ExtractedTextNode[] = [];
  let id = 0;

  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  walk($, root, [], (node, ancestors) => {
    const raw = (node as { data?: string }).data ?? "";
    const text = raw.trim();
    if (!text) return;
    nodes.push({
      id: id++,
      tag: ancestors[ancestors.length - 1] ?? "body",
      label: labelFor(ancestors),
      text,
    });
  });

  return nodes;
}

/**
 * Re-parses the SAME html the ids came from and reconstructs the identical id sequence,
 * then overwrites each requested text node's data in place before re-serializing. Ids not
 * present in `edits` are left untouched. Leading/trailing whitespace around the original
 * text node is preserved (only the trimmed core is replaced) so spacing between inline
 * elements — e.g. "Some <a>link</a> text." — doesn't visibly collapse.
 */
export function applyTextEdits(html: string, edits: { id: number; text: string }[]): string {
  const $ = cheerio.load(html);
  const editById = new Map(edits.map((e) => [e.id, e.text]));
  let id = 0;

  const root = $("body").length > 0 ? $("body").get(0)! : $.root().get(0)!;
  walk($, root, [], (node) => {
    const textNode = node as { data?: string };
    const raw = textNode.data ?? "";
    const trimmed = raw.trim();
    if (!trimmed) return;
    const currentId = id++;
    const replacement = editById.get(currentId);
    if (replacement === undefined) return;
    const leading = raw.slice(0, raw.indexOf(trimmed));
    const trailing = raw.slice(raw.indexOf(trimmed) + trimmed.length);
    textNode.data = `${leading}${replacement}${trailing}`;
  });

  return $.html();
}
