const WORDS_PER_MINUTE = 200;

/** Walks Tiptap/ProseMirror JSON and concatenates every text node's content. */
function extractPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractPlainText).join(" ");
  return "";
}

export function estimateReadingTimeMinutes(contentJson: unknown): number {
  const words = extractPlainText(contentJson).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Strips tags/collapses whitespace from rendered HTML for a fallback excerpt/meta description. */
export function autoExcerpt(html: string, maxLength = 160): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}
