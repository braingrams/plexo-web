/**
 * Plain-words rules for the Shop settings screens in the hub (General, Payments, Checkout, Emails).
 * Pure: what counts as unsaved, what each payment method needs, what to tell the owner when something is missing,
 * and the example order emails. The real work (saving, validating again) stays in the settings API.
 */

export function isDirty<T>(saved: T, now: T): boolean {
  return JSON.stringify(saved) !== JSON.stringify(now);
}

export type SaveStatus = { tone: "clean" | "dirty" | "saving" | "saved" | "error"; text: string };
export function saveStatus(o: { dirty: boolean; saving: boolean; justSaved: boolean; error: string | null }): SaveStatus {
  if (o.saving) return { tone: "saving", text: "Saving…" };
  if (o.error) return { tone: "error", text: o.error };
  if (o.dirty) return { tone: "dirty", text: "You have changes that aren't saved yet." };
  if (o.justSaved) return { tone: "saved", text: "Saved. Your shop is up to date." };
  return { tone: "clean", text: "All changes saved." };
}

/* ------------------------------------------------------------------ general */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function emailProblem(email: string, what = "email address"): string | null {
  const v = email.trim();
  if (!v) return null;
  return EMAIL.test(v) ? null : `That doesn't look like an ${what}. It should look like name@example.com.`;
}

/** A shop page address: lowercase letters, numbers and dashes. */
export function shopAddressProblem(slug: string): string | null {
  const v = slug.trim();
  if (!v) return "Type a short name for your shop page, like “shop”.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) return "Use only lowercase letters, numbers and dashes, like “my-shop”.";
  return null;
}
export const cleanShopAddress = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/* ------------------------------------------------------------------ payments */

export type Provider = "BYO_PAYSTACK" | "PLATFORM_PAYSTACK" | "PLATFORM_STRIPE" | "BYO_STRIPE";

export const PROVIDERS: { id: Provider; group: "Paystack" | "Stripe"; title: string; body: string }[] = [
  { id: "PLATFORM_PAYSTACK", group: "Paystack", title: "Let Plexo collect for me", body: "No keys to find. Customers pay through Plexo and you take your money out under Your money." },
  { id: "BYO_PAYSTACK", group: "Paystack", title: "Use my own Paystack account", body: "Money goes straight into your Paystack account." },
  { id: "PLATFORM_STRIPE", group: "Stripe", title: "Let Plexo collect for me", body: "Needs a quick approval from us first. Customers can pay from many countries." },
  { id: "BYO_STRIPE", group: "Stripe", title: "Use my own Stripe account", body: "Money goes straight into your Stripe account." },
];

export type PaymentFields = {
  provider: Provider;
  paystackMode: "TEST" | "LIVE";
  paystackPublic: { TEST: string; LIVE: string };
  paystackSecretSet: { TEST: boolean; LIVE: boolean };
  paystackSecretNew: { TEST: string; LIVE: string };
  stripeMode: "TEST" | "LIVE";
  stripePublic: { TEST: string; LIVE: string };
  stripeSecretSet: { TEST: boolean; LIVE: boolean };
  stripeSecretNew: { TEST: string; LIVE: string };
};

/** What is still missing for the chosen card method, in the owner's words. Empty = ready. */
export function cardSetupGaps(f: PaymentFields, stripeAccess: "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "LOADING" = "APPROVED"): string[] {
  if (f.provider === "PLATFORM_PAYSTACK") return [];
  if (f.provider === "PLATFORM_STRIPE") return stripeAccess === "APPROVED" ? [] : ["Plexo's Stripe needs our approval first"];
  const paystack = f.provider === "BYO_PAYSTACK";
  const mode = paystack ? f.paystackMode : f.stripeMode;
  const pub = (paystack ? f.paystackPublic : f.stripePublic)[mode].trim();
  const secret = (paystack ? f.paystackSecretSet : f.stripeSecretSet)[mode] || !!(paystack ? f.paystackSecretNew : f.stripeSecretNew)[mode].trim();
  const name = paystack ? "Paystack" : "Stripe";
  const gaps: string[] = [];
  if (!pub) gaps.push(`your ${name} public key`);
  if (!secret) gaps.push(`your ${name} secret key`);
  return gaps;
}

export function cardStatus(f: PaymentFields, access?: Parameters<typeof cardSetupGaps>[1]): { text: string; tone: "success" | "warning" } {
  const gaps = cardSetupGaps(f, access);
  if (!gaps.length) {
    const live = f.provider === "BYO_PAYSTACK" ? f.paystackMode === "LIVE" : f.provider === "BYO_STRIPE" ? f.stripeMode === "LIVE" : true;
    return live ? { text: "Ready to take real payments", tone: "success" } : { text: "Connected in test mode. No real money moves yet", tone: "warning" };
  }
  return { text: `Still needed: ${gaps.join(" and ")}`, tone: "warning" };
}

export type BankFields = { enabled: boolean; bankName: string; accountName: string; accountNumber: string; instructions: string };
export function bankProblem(b: BankFields): string | null {
  if (!b.enabled) return null;
  const missing = [!b.bankName.trim() && "bank", !b.accountName.trim() && "name on the account", !b.accountNumber.trim() && "account number"].filter(Boolean);
  if (missing.length) return `To accept bank transfers, fill in your ${missing.join(", ")}. Customers need them to pay you.`;
  if (!/^[0-9 -]{6,}$/.test(b.accountNumber.trim())) return "Your account number should be just numbers, like 0123456789.";
  return null;
}

/* ------------------------------------------------------------------ checkout */

export type Question = { label: string; type: string; limited: boolean; countries: string[] };
export function questionProblem(qs: Question[]): string | null {
  for (const q of qs) {
    if (!q.label.trim()) return "Every question needs some words, like “Gift message”. Fill in the empty one or remove it.";
    if (q.limited && q.countries.length === 0) return `Pick at least one country for “${q.label.trim()}”, or set it back to Everyone.`;
  }
  return null;
}
export function receiveProblem(delivery: boolean, pickup: boolean): string | null {
  return delivery || pickup ? null : "Keep delivery or pickup switched on. Otherwise people have no way to receive what they buy.";
}

/* ------------------------------------------------------------------ emails */

export type EmailEvent = "Paid" | "Processing" | "ReadyForPickup" | "Shipped" | "Completed" | "Refunded";
export const EMAIL_EVENTS: { id: EmailEvent; title: string; when: string }[] = [
  { id: "Paid", title: "We got your order", when: "Right after someone pays" },
  { id: "Processing", title: "Getting it ready", when: "When you mark an order as being prepared" },
  { id: "ReadyForPickup", title: "Ready to collect", when: "When you mark an order ready for pickup" },
  { id: "Shipped", title: "On its way", when: "When you mark an order as shipped" },
  { id: "Completed", title: "All done", when: "When you mark an order as done" },
  { id: "Refunded", title: "Your refund", when: "When you refund an order" },
];

/** An example of what customers read, filled with this shop's name. It is a guide, not the exact email. */
export function emailPreview(event: EmailEvent, shop: string): { subject: string; body: string } {
  const s = shop.trim() || "our shop";
  switch (event) {
    case "Paid": return { subject: `Thanks! We've got your order from ${s}`, body: `Hi Ada,\n\nThank you for your order. We've received your payment and we're on it.\n\nOrder #1042\n1 × Jollof spice mix\n\nWe'll email you again as soon as there's news.\n\n${s}` };
    case "Processing": return { subject: `${s} is getting your order ready`, body: `Hi Ada,\n\nGood news. We're getting order #1042 ready for you.\n\n${s}` };
    case "ReadyForPickup": return { subject: `Your order is ready to collect`, body: `Hi Ada,\n\nOrder #1042 is ready. Come and collect it whenever suits you.\n\n${s}` };
    case "Shipped": return { subject: `Your order from ${s} is on its way`, body: `Hi Ada,\n\nOrder #1042 has left us and is on its way to you.\n\n${s}` };
    case "Completed": return { subject: `Your order is complete`, body: `Hi Ada,\n\nOrder #1042 is complete. Thank you for buying from ${s}. We hope you love it.\n\n${s}` };
    default: return { subject: `Your refund from ${s}`, body: `Hi Ada,\n\nWe've refunded order #1042. It can take a few days to reach your account.\n\n${s}` };
  }
}

/** "From Ada's Spices · changed Oct 8" for the list of designs you can reuse. */
export function layoutCandidateLine(siteName: string, updatedAt: string): string {
  const d = new Date(updatedAt);
  const when = Number.isNaN(d.getTime()) ? "" : ` · changed ${d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`;
  return `From ${siteName}${when}`;
}

/** "3 orders · since Oct 2026" */
export function customerLine(orderCount: number, since: string): string {
  const d = new Date(since);
  const when = Number.isNaN(d.getTime()) ? "" : ` · since ${d.toLocaleDateString("en", { month: "short", year: "numeric" })}`;
  return `${orderCount} ${orderCount === 1 ? "order" : "orders"}${when}`;
}
