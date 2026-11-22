/** Reading and rewriting the visible text of a design page. Pure and browser-safe (no server imports). */

export type TextNode = { id: number; text: string };

const SKIPPED_ELEMENTS = ["script", "style", "noscript", "svg", "template", "textarea", "iframe"];
const TOKEN = new RegExp(`<!--[\\s\\S]*?-->|<(${SKIPPED_ELEMENTS.join("|")})\\b[\\s\\S]*?<\\/\\1\\s*>|<[^>]+>`, "gi");

/** Most snippets SOL is asked to look at, and the most characters of them (a page's headlines, cards and buttons come well under this). */
export const MAX_NODES = 260;
const MAX_NODE_CHARS = 220;
const MAX_TOTAL_CHARS = 14_000;
const MAX_REPLACEMENT_CHARS = 600;

export function decodeEntities(s: string): string {
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
export function mapText(html: string, onText: (id: number, text: string) => string | undefined): string {
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
