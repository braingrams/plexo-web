// Form captcha — the "I'm not a robot" check a site had on WordPress (Cloudflare Turnstile,
// Google reCAPTCHA, hCaptcha), kept working on Plexo. The owner's own site key + secret key
// are stored per form (FormSettings); the widget is drawn by public/plexo-forms.js and the
// answer is verified here, on the server, before a submission is accepted.

export type CaptchaProvider = "turnstile" | "recaptcha" | "hcaptcha";

export const CAPTCHA_PROVIDERS: CaptchaProvider[] = ["turnstile", "recaptcha", "hcaptcha"];

export const CAPTCHA_LABELS: Record<CaptchaProvider, string> = {
  turnstile: "Cloudflare Turnstile",
  recaptcha: "Google reCAPTCHA",
  hcaptcha: "hCaptcha",
};

/** The name of the hidden field each provider's widget fills with the visitor's answer. */
export const CAPTCHA_RESPONSE_FIELDS: Record<CaptchaProvider, string> = {
  turnstile: "cf-turnstile-response",
  recaptcha: "g-recaptcha-response",
  hcaptcha: "h-captcha-response",
};

const VERIFY_URLS: Record<CaptchaProvider, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
  hcaptcha: "https://api.hcaptcha.com/siteverify",
};

export function isCaptchaProvider(value: unknown): value is CaptchaProvider {
  return typeof value === "string" && (CAPTCHA_PROVIDERS as string[]).includes(value);
}

/** Site keys are public, short, URL-safe strings — reject anything else before it reaches a page. */
export function validSiteKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

/** Every response field name, so they can be kept out of what the owner reads in their inbox. */
export const ALL_CAPTCHA_RESPONSE_FIELDS = new Set(Object.values(CAPTCHA_RESPONSE_FIELDS));

/**
 * Checks a visitor's answer with the provider. Returns false for a missing, expired or wrong
 * answer. When the provider can't be reached, it returns "unavailable" so a real visitor isn't
 * locked out of the owner's contact form by someone else's outage (the honeypot and rate
 * limit still apply).
 */
export async function verifyCaptcha(input: { provider: CaptchaProvider; secret: string; token: string | null; ip?: string | null; hostname?: string }): Promise<"ok" | "failed" | "unavailable"> {
  if (!input.token) return "failed";
  try {
    const body = new URLSearchParams({ secret: input.secret, response: input.token });
    if (input.ip && input.ip !== "unknown") body.set("remoteip", input.ip);
    const res = await fetch(VERIFY_URLS[input.provider], { method: "POST", body, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { success?: boolean };
    return data.success ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
