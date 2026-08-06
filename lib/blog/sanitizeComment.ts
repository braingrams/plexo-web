const MAX_COMMENT_LENGTH = 3000;

/**
 * Plain-text only — no HTML allowlist at all, unlike sanitizeBlogHtml. A comment is the
 * most adversarial input surface in this app (fully anonymous, no login, unlike post
 * content which always comes from the site owner or the WordPress importer): every
 * character is escaped, and the only formatting preserved is line breaks.
 */
export function sanitizeCommentBody(input: string): string {
  const trimmed = input.trim().slice(0, MAX_COMMENT_LENGTH);
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

/** Crude spam heuristic — two or more bare URLs in a comment auto-buckets it into SPAM (still reviewable) rather than PENDING. */
export function countLinksInCommentBody(rawInput: string): number {
  const matches = rawInput.match(/https?:\/\/\S+/gi);
  return matches ? matches.length : 0;
}
