/**
 * Terms of sale and refund policy: a friendly starting text the owner can edit, where the link customers see
 * points (their own page, or a hosted copy of what they wrote), and the plain page that hosts it.
 * Pure, so the rules are tested once (tests/shopTerms.test.ts).
 */

export const TERMS_PATH = "/api/public/commerce/terms";

type TermsSettings = { termsText?: string | null; termsUrl?: string | null } | null | undefined;

/** The link customers get at checkout and in emails, or null when the owner hasn't set any terms. */
export function termsLink(settings: TermsSettings, origin: string): { url: string; custom: boolean } | null {
  const url = settings?.termsUrl?.trim();
  if (url) return { url, custom: true };
  if (settings?.termsText?.trim()) return { url: `${origin.replace(/\/$/, "")}${TERMS_PATH}`, custom: false };
  return null;
}

/** A plain starting point in everyday words. The owner changes it to fit; nothing here is legal advice. */
export function defaultTerms(shopName: string, contactEmail: string): string {
  const shop = shopName.trim() || "our shop";
  const contact = contactEmail.trim() ? `email us at ${contactEmail.trim()}` : "get in touch with us";
  return [
    `Terms of sale for ${shop}`,
    `Orders\nWhen you place an order, you're asking to buy what's in your basket at the price shown. Your order is confirmed once your payment is received. We may cancel an order and refund you in full if something you ordered is out of stock or we can't deliver it.`,
    `Delivery and collection\nWe'll tell you how long delivery usually takes at checkout. If you chose to collect your order, we'll let you know when it's ready.`,
    `Returns and refunds\nIf something isn't right, ${contact} within 7 days of getting your order. Send it back unused and in its original packaging and we'll refund you. Things made just for you, and downloads, can't be returned unless they're faulty.`,
    `Faulty or wrong items\nIf we send you something faulty or the wrong item, ${contact} and we'll replace it or refund you, and cover the cost of sending it back.`,
    `Questions\nIf you're unsure about anything, ${contact}. We're happy to help.`,
  ].join("\n\n");
}

/** The words SOL is asked when an owner wants it written for them. */
export function termsPromptForSol(shopName: string): string {
  return `Write simple, friendly terms of sale and a refund policy for my shop "${shopName}". Ask me a few questions first (what I sell, how I deliver, how long people have to return things), then save the result as my shop's terms.`;
}

export function termsUrlProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return null;
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v) ? null : "The link should start with https://, like https://yoursite.com/terms.";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The hosted page: the owner's words as readable paragraphs. Everything is escaped. */
export function renderTermsHtml(shopName: string, text: string): string {
  const blocks = text.trim().split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const body = blocks.map((b, i) => {
    const [first, ...rest] = b.split("\n");
    if (rest.length && first.length <= 60 && i > 0) return `<h2>${esc(first)}</h2><p>${esc(rest.join("\n")).replace(/\n/g, "<br>")}</p>`;
    return i === 0 && !rest.length ? `<h1>${esc(first)}</h1>` : `<p>${esc(b).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms of sale – ${esc(shopName)}</title><style>body{font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1b1b;max-width:720px;margin:0 auto;padding:32px 20px}h1{font-size:28px;line-height:1.2}h2{font-size:19px;margin:28px 0 4px}p{margin:8px 0}</style></head><body>${body}</body></html>`;
}
