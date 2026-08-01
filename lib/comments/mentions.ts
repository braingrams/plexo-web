// Comment bodies store mentions inline as `@[Name](userId:<uuid>)` — similar to a
// markdown link, chosen so the raw stored string is still human-readable even before
// any client-side rendering turns it into a styled mention chip.
const MENTION_PATTERN = /@\[([^\]]+)\]\(userId:([0-9a-f-]{36})\)/gi;

export function parseMentionedUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    ids.add(match[2]);
  }
  return [...ids];
}

/** Renders mention tokens down to plain "@Name" text — used for email subjects/snippets. */
export function mentionsToPlainText(body: string): string {
  return body.replace(MENTION_PATTERN, (_match, name) => `@${name}`);
}

/** Truncates a comment body (after stripping mention markup) for an email preview snippet. */
export function commentSnippet(body: string, maxLength = 140): string {
  const plain = mentionsToPlainText(body).trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}

export type MentionSegment = { type: "text"; value: string } | { type: "mention"; name: string; userId: string };

/** Splits a stored comment body into plain-text and mention segments, for rendering mention chips client-side. */
export function splitMentionSegments(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ type: "text", value: body.slice(lastIndex, index) });
    segments.push({ type: "mention", name: match[1], userId: match[2] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) segments.push({ type: "text", value: body.slice(lastIndex) });
  return segments;
}
