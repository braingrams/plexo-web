/**
 * Merge tags for emails: the placeholders ({{first_name}}) that the sender replaces for each person.
 * One list for everything: the editor's "Insert field" menu, the live preview's sample values, the template API
 * (which tells a sending tool which tags an email uses) and the render call that fills them.
 */

export type EmailMergeTag = { key: string; label: string; category: "Contact" | "Email"; sample: string; /** What the sender fills in, in plain words. */ help: string };

export const EMAIL_MERGE_TAGS: readonly EmailMergeTag[] = [
  { key: "first_name", label: "First name", category: "Contact", sample: "Ada", help: "The person's first name" },
  { key: "last_name", label: "Last name", category: "Contact", sample: "Lovelace", help: "The person's last name" },
  { key: "email", label: "Email address", category: "Contact", sample: "ada@example.com", help: "The address this email is sent to" },
  { key: "unsubscribe_url", label: "Unsubscribe link", category: "Email", sample: "https://example.com/unsubscribe", help: "A link that lets the person stop getting emails" },
  { key: "view_in_browser_url", label: "View in browser link", category: "Email", sample: "https://example.com/view", help: "A link that opens this email in a web page" },
];

const TAG = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
const KNOWN = new Set(EMAIL_MERGE_TAGS.map((t) => t.key));

export const tagToken = (key: string): string => `{{${key}}}`;

/** The shape the SDK editor's Merge Tags tab takes. */
export const editorMergeTags = (): { label: string; value: string; category: string }[] =>
  EMAIL_MERGE_TAGS.map((t) => ({ label: t.label, value: tagToken(t.key), category: t.category }));

/** Every merge tag an email uses, in the order they first appear. `known` is false for a tag the sender doesn't fill. */
export function findMergeTags(html: string): { key: string; known: boolean }[] {
  const seen = new Set<string>();
  const out: { key: string; known: boolean }[] = [];
  for (const m of html.matchAll(TAG)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ key: m[1], known: KNOWN.has(m[1]) });
  }
  return out;
}

export const sampleValues = (): Record<string, string> => Object.fromEntries(EMAIL_MERGE_TAGS.map((t) => [t.key, t.sample]));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Replace tags with values. A tag with no value is left as it is, so nothing silently vanishes. Values are HTML-escaped. */
export function fillMergeTags(html: string, values: Record<string, string | undefined>): string {
  return html.replace(TAG, (whole, key: string) => {
    const v = values[key];
    return typeof v === "string" ? esc(v) : whole;
  });
}

/** Tags used by the email that have no value in `values` (so the caller can say what is missing). */
export function missingMergeTags(html: string, values: Record<string, string | undefined>): string[] {
  return findMergeTags(html).filter((t) => typeof values[t.key] !== "string").map((t) => t.key);
}

/**
 * Emails never need scripts, so anything that runs code or loads another page is removed from pasted HTML:
 * script/iframe/object/embed/form elements, on* handlers and javascript: links. Everything visual is kept.
 */
export function cleanEmailHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|form|base|input|button\s+formaction)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

/** Things email apps (Gmail, Outlook) commonly drop, in plain words, so a pasted web page doesn't surprise anyone. */
export function emailHtmlWarnings(html: string): string[] {
  const out: string[] = [];
  if (/<\s*(script|iframe|form)\b/i.test(html)) out.push("Scripts, forms and embedded pages don't work in email, so they are removed when you save.");
  if (/\b(display\s*:\s*(flex|grid)|position\s*:\s*(absolute|fixed))/i.test(html)) out.push("Some email apps (Outlook especially) ignore flexbox, grid and absolute positioning, so the layout may look different once sent. Tables are the safest.");
  if (/<\s*link\b[^>]*stylesheet/i.test(html)) out.push("Linked stylesheets are ignored by many email apps. Put the styles inline instead.");
  if (/src\s*=\s*["'](?!https?:|data:|cid:)/i.test(html)) out.push("A picture uses a file path instead of a web address, so it won't show in the email. Use a full https:// link.");
  return out;
}
