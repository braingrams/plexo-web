/**
 * What forms send along that no person typed: verification-box answers, spam-detector readings, WordPress plumbing. They are never
 * stored for new submissions and never shown for old ones, so the owner only sees what the visitor actually wrote.
 */
const TECHNICAL = [
  /^_plx_check$/i,
  /^cf-turnstile-response$/i,
  /^g-recaptcha-response$/i,
  /^h-captcha-response$/i,
  /^(captcha|recaptcha|hcaptcha|turnstile)([-_ ].*)?$/i,
  /^maspik/i,
  /^_hp_field$/i,
  /^(honeypot|hp|website_url|url_hp)$/i,
  /^(action|.*nonce|_wp_http_referer|security|_ajax_nonce|form_id|post_id|page_id|queried_id|referer_title|referrer|referer)$/i,
  /^form_fields\[?(form_id|post_id|queried_id|referer_title)/i,
  /^_?(wpcf7|wpforms|gform|et_pb|elementor)[-_]/i,
];

export const isTechnicalField = (key: string): boolean => TECHNICAL.some((re) => re.test(key.trim()));

/** The fields a person actually filled in, in the order they were sent. */
export function visibleFields(fields: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (isTechnicalField(k)) continue;
    const text = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (text) out.push([k, text]);
  }
  return out;
}

/** "form_fields[email]" or "your-name" read as the question a person would recognise ("Email", "Your name"). */
export function fieldLabel(key: string): string {
  const inner = key.match(/\[([^\]]+)\]$/)?.[1] ?? key;
  const spaced = inner.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who sent it and how to reach them, found from the answers (an email-looking value, a name-like field). */
export function submitterOf(fields: Array<[string, string]>): { name: string | null; email: string | null } {
  const email = fields.find(([, v]) => EMAIL.test(v))?.[1] ?? null;
  const name = fields.find(([k, v]) => /(^|[\s_-])(full[\s_-]?)?(your[\s_-]?)?name$/i.test(k.trim()) && !EMAIL.test(v))?.[1] ?? null;
  return { name, email };
}
