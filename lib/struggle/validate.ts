import type { StruggleSignal } from "./detector";

export const MAX_MESSAGE = 2000;
export const MAX_SCREENSHOT_BYTES = 1_500_000;
export const CATEGORIES = ["broke", "confusing", "missing", "other"] as const;
export type FeedbackCategory = (typeof CATEGORIES)[number];
const SIGNALS: StruggleSignal[] = ["rage_click", "dead_click", "failed_requests", "repeated_error", "js_error", "boundary", "stuck", "nav_loop"];
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export type FeedbackInput = {
  message: string;
  type: "feedback" | "struggle";
  category?: FeedbackCategory;
  signals: StruggleSignal[];
  pageUrl?: string;
  browser?: string;
  screenshot?: { bytes: Buffer; contentType: string; ext: string };
};

/** Strip query/hash (they can carry tokens or ids) and cap length. */
export function cleanPath(p: unknown): string | undefined {
  if (typeof p !== "string") return undefined;
  const path = p.split(/[?#]/)[0].trim().slice(0, 200);
  return path || undefined;
}

/** Validates the untrusted body. Errors are written for the owner, not a developer. */
export function parseFeedbackBody(body: unknown): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { ok: false, error: "Please tell us a little about what happened." };
  if (message.length > MAX_MESSAGE) return { ok: false, error: `That is a bit long. Please keep it under ${MAX_MESSAGE} characters.` };

  const category = CATEGORIES.find((c) => c === b.category);
  const signals = Array.isArray(b.signals) ? SIGNALS.filter((s) => (b.signals as unknown[]).includes(s)) : [];
  const browser = typeof b.browser === "string" ? b.browser.trim().slice(0, 80) || undefined : undefined;

  let screenshot: FeedbackInput["screenshot"];
  if (typeof b.screenshot === "string" && b.screenshot) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.screenshot);
    if (!m) return { ok: false, error: "We could not read that screenshot. Please attach a PNG, JPG or WebP image." };
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > MAX_SCREENSHOT_BYTES) return { ok: false, error: "That screenshot is too large. Please attach one under 1.5 MB." };
    screenshot = { bytes, contentType: m[1], ext: IMAGE_TYPES[m[1]] };
  }

  return {
    ok: true,
    value: { message, type: b.type === "struggle" ? "struggle" : "feedback", category, signals, pageUrl: cleanPath(b.pageUrl), browser, screenshot },
  };
}
