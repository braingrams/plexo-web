/**
 * A lightweight, no-schema-change heuristic for flagging a form submission as likely spam
 * in the dashboard — NOT used to block a submission at request time (that's the honeypot +
 * rate limit in app/api/public/forms/[templateId]/submit/route.ts). Server-side blocking
 * of a genuine-looking, manually-typed pitch (the common case here — a real person or
 * outreach tool filling out the actual form, not a bot) isn't reliably possible without a
 * CAPTCHA service the site owner would have to sign up for and configure; this instead
 * gives the owner a fast, zero-setup way to spot and bulk-delete the obvious cases
 * (multiple promotional links, canned SEO/outreach phrasing, or literal gibberish) that
 * make up most of what actually shows up.
 */

const URL_PATTERN = /https?:\/\/\S+/gi;

const SPAM_PHRASES = [
  "seo", "backlink", "guest post", "link building", "increase your ranking",
  "improve your ranking", "google ranking", "search engine optimization",
  "unsubscribe", "we are shutting down", "database of companies", "million companies",
  "million businesses", "b2b data", "email list", "buy now", "crypto", "bitcoin",
  "investment opportunity", "loan offer", "work from home", "click here",
];

/** True if `value` reads as random keyboard-mash rather than a real word/sentence — no
 * vowels across a long run of letters is the one shape a genuine message (in any language
 * this platform's forms actually see) never has. */
function looksLikeGibberish(value: string): boolean {
  const letters = value.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 12) return false;
  return !/[aeiouAEIOU]/.test(letters);
}

export function spamReasons(fields: Record<string, string>): string[] {
  const reasons: string[] = [];
  const values = Object.values(fields);
  const combined = values.join(" ");

  const urlMatches = combined.match(URL_PATTERN);
  if (urlMatches && urlMatches.length >= 2) reasons.push(`Contains ${urlMatches.length} links`);

  const lower = combined.toLowerCase();
  const matchedPhrase = SPAM_PHRASES.find((phrase) => lower.includes(phrase));
  if (matchedPhrase) reasons.push(`Mentions "${matchedPhrase}"`);

  if (values.some(looksLikeGibberish)) reasons.push("Looks like random text");

  return reasons;
}

export function isLikelySpam(fields: Record<string, string>): boolean {
  return spamReasons(fields).length > 0;
}
