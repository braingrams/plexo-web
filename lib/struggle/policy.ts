/**
 * When the nudge is allowed to appear. Pure functions over a small state object that the
 * client keeps in localStorage; the rules are: at most once per session, once per day per
 * user, never after "Don't show again", and never while the owner is typing, entering
 * payment details, or looking at a dialog.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type NudgeMemory = {
  /** ms epoch of the last time the nudge was shown to this user. */
  lastShownAt?: number;
  optedOut?: boolean;
};

export type NudgeContext = {
  shownThisSession: boolean;
  typing: boolean;
  onPaymentField: boolean;
  modalOpen: boolean;
};

export function canShowNudge(
  now: number,
  memory: NudgeMemory,
  ctx: NudgeContext,
): { ok: true } | { ok: false; reason: "opted_out" | "session" | "daily" | "typing" | "payment" | "modal" } {
  if (memory.optedOut) return { ok: false, reason: "opted_out" };
  if (ctx.shownThisSession) return { ok: false, reason: "session" };
  if (memory.lastShownAt !== undefined && now - memory.lastShownAt < DAY_MS) return { ok: false, reason: "daily" };
  if (ctx.onPaymentField) return { ok: false, reason: "payment" };
  if (ctx.typing) return { ok: false, reason: "typing" };
  if (ctx.modalOpen) return { ok: false, reason: "modal" };
  return { ok: true };
}

const storageKey = (userId: string) => `plexo:feedback-nudge:${userId}`;

export function readMemory(userId: string, storage?: Pick<Storage, "getItem">): NudgeMemory {
  try {
    const raw = (storage ?? localStorage).getItem(storageKey(userId));
    const v = raw ? JSON.parse(raw) : {};
    return {
      lastShownAt: typeof v.lastShownAt === "number" ? v.lastShownAt : undefined,
      optedOut: v.optedOut === true,
    };
  } catch {
    return {};
  }
}

export function writeMemory(userId: string, memory: NudgeMemory, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(storageKey(userId), JSON.stringify(memory));
  } catch {
    /* private mode / blocked storage: the per-session flag still limits repeats */
  }
}

// ---- DOM-shaped checks, written against minimal interfaces so they test without a DOM.

type ElLike = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (n: string) => string | null;
  closest?: (sel: string) => ElLike | null;
};

const TEXT_INPUT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number", "date", ""]);

export function isTypingTarget(el: ElLike | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || el.isContentEditable) return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((el.getAttribute?.("type") ?? "").toLowerCase());
  return false;
}

const PAYMENT_AUTOCOMPLETE = /^cc-|card/i;
export function isPaymentField(el: ElLike | null | undefined): boolean {
  if (!el) return false;
  if (el.closest?.("iframe[name^='__privateStripeFrame'], [data-stripe], [data-payment], [data-checkout]")) return true;
  if ((el.tagName ?? "").toUpperCase() === "IFRAME") return true;
  const ac = el.getAttribute?.("autocomplete") ?? "";
  if (PAYMENT_AUTOCOMPLETE.test(ac)) return true;
  const name = `${el.getAttribute?.("name") ?? ""} ${el.getAttribute?.("id") ?? ""}`;
  return /card|cvc|cvv|iban|routing|account.?number/i.test(name);
}

export function onPaymentPath(path: string): boolean {
  return /\/(checkout|billing|payment|pay|subscribe|upgrade)(\/|$|\?)/i.test(path);
}

/** Pages where "nothing is moving for 90s" really means the owner is stuck. */
export function isGuidedStepPath(path: string): boolean {
  return /^\/dashboard\/(new|migrate|compile)(\/|$)|onboarding|get-started|guided/i.test(path);
}

export function isInteractiveTarget(el: ElLike | null | undefined): boolean {
  if (!el) return false;
  return !!el.closest?.(
    "a[href], button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='switch'], [onclick], [tabindex], [contenteditable='true'], [data-interactive]",
  );
}
