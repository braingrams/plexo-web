/**
 * What the Plan & billing screens say about plans, in plain words. This is the one place the
 * screens read plan names, limits and prices from: names from lib/plan/plans.ts, limits from
 * lib/subscription.ts, prices from the price book via `priceSourceFrom(PricingView)` (the
 * person's own currency, lib/billing/pricing.ts).
 * Pure.
 */
import { getTierFeatures } from "@/lib/subscription";
import { PLAN_MONTHLY_AI_USD } from "@/lib/credits/value";
import { PLAN_IDS, PLAN_LABELS, PLAN_RANK, toPlanId, type PlanId, PLAN, PAID_PLAN_IDS } from "@/lib/plan/plans";
import type { PricingView } from "@/lib/billing/pricing";

export type { PlanId };

/** Price labels per plan in the person's own currency, e.g. { STARTER: "N13,500 a month" }. */
export type PriceSource = Partial<Record<PlanId, string>>;

export type PlanView = { id: PlanId; name: string; tagline: string; price: string | null; included: string[] };

const TAGLINES: Record<PlanId, string> = {
  FREE: "Try Plexo with one live website.",
  STARTER: "For a growing business with its own web address.",
  PRO: "For people who build a lot, with more websites and more AI help.",
  ENTERPRISE: "Your own brand everywhere, with a dedicated contact.",
};

/** Any stored or current plan value, in today's terms (the retired Ultra reads as Pro). */
export const billingPlanId = (p: string | null | undefined): PlanId => toPlanId(p);

export const planName = (id: PlanId): string => PLAN_LABELS[id];

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The price book's prices for this person, as plain labels ("N13,500 a month"; Enterprise "from ..."). */
export function priceSourceFrom(pricing: PricingView | null | undefined): PriceSource {
  if (!pricing) return {};
  const out: PriceSource = {};
  for (const id of PAID_PLAN_IDS) {
    const p = pricing.plans[id];
    if (p) out[id] = `${p.isFromPrice ? "from " : ""}${p.monthlyLabel} a month`;
  }
  return out;
}

export function planView(id: PlanId, prices: PriceSource = {}): PlanView {
  const f = getTierFeatures(id);
  const included: string[] = [];
  included.push(f.maxPublishedSites === null ? "As many live websites as you like" : f.maxPublishedSites === 1 ? "1 live website" : `${f.maxPublishedSites} live websites`);
  included.push(f.maxPublishedPagesPerSite === null ? "Every page of your site online" : "Your homepage online (other pages stay saved)");
  included.push(f.customDomainEnabled ? "Your own web address, like mybusiness.com" : "A free Plexo web address");
  included.push(`AI help worth ${money(PLAN_MONTHLY_AI_USD[id])} every month`);
  if (f.teamSeats > 0) included.push(`Room for ${count(f.teamSeats, "teammate", "teammates")}`);
  if (f.commerceEnabled) included.push("An online store to sell products");
  if (f.brandingRemovalEnabled) included.push("No \u201cHosted with Plexo\u201d bar on your site");
  if (f.siteMigrationEnabled) included.push("Bring a site in from WordPress or another builder");
  if (f.includedFunnelSlots > 0) included.push(`${count(f.includedFunnelSlots, "course or members area", "courses or members areas")} included`);
  return { id, name: PLAN_LABELS[id], tagline: TAGLINES[id], price: prices[id] ?? null, included };
}

export const UPGRADE_ORDER: PlanId[] = [...PLAN_IDS].sort((a, b) => PLAN_RANK[a] - PLAN_RANK[b]);

/** The plans worth offering: everything above the current one. */
export function plansAbove(current: PlanId): PlanId[] {
  return UPGRADE_ORDER.slice(UPGRADE_ORDER.indexOf(current) + 1);
}

export type PlanState = {
  plan: PlanId;
  /** A paid subscription is behind the plan. */
  paying: boolean;
  basis?: "TRIAL" | "GRANT" | "SUBSCRIPTION" | "ADMIN_KEPT" | null;
  daysLeft?: number | null;
  endsAt?: string | null;
  renewsAt?: string | null;
  pastDue?: boolean;
  /** Paid once (no automatic renewal): the plan simply runs to `endsAt`. */
  oneTime?: boolean;
  /** For a one-time plan: whether they paid for a month or a year, so "pay again" repeats it. */
  oneTimeInterval?: "monthly" | "yearly";
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** One plain sentence on where the plan stands. */
export function planStatusLine(s: PlanState): string {
  const name = PLAN_LABELS[s.plan];
  if (s.plan === PLAN.FREE) return "You're on the Free plan. It's yours for as long as you like.";
  if (s.pastDue) return `We couldn't take your last payment. ${name} stays on while we try again. You can update your card below.`;
  if (s.basis === "TRIAL") return `You're trying ${name} free${s.daysLeft != null ? `. ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left` : ""}. Nothing is charged unless you subscribe.`;
  if (s.basis === "GRANT") return `${name} is on us${s.daysLeft != null ? ` for ${s.daysLeft} more day${s.daysLeft === 1 ? "" : "s"}` : ""}. There's nothing to pay.`;
  if (s.basis === "ADMIN_KEPT") return `Your ${name} plan is provided by Plexo. There's nothing to pay.`;
  if (s.oneTime && s.endsAt) return `You've paid for ${name} until ${day(s.endsAt)}. It won't renew by itself, so pay again before then to keep it.`;
  if (s.endsAt) return `You've cancelled. ${name} keeps working until ${day(s.endsAt)}.`;
  if (s.renewsAt) return `Your ${name} plan renews on ${day(s.renewsAt)}.`;
  return `You're on the ${name} plan.`;
}

/** What cancelling does, before they do it. Null when there's nothing to cancel. */
export function cancelExplanation(s: PlanState): string | null {
  if (!s.paying || s.endsAt) return null;
  const name = PLAN_LABELS[s.plan];
  return `You can cancel any time. You keep ${name} until the end of what you've paid for. After that, one website stays online with its homepage. Nothing is deleted, and everything comes back if you subscribe again.`;
}

export type CreditView = { total: number; allowance: number; topup: number; resetsInDays: number; low: boolean; negative: boolean };

export function creditView(allowance: number, topup: number, resetAt: string, now: number = Date.now()): CreditView {
  const total = allowance + topup;
  const resetsInDays = Math.max(0, Math.ceil((new Date(resetAt).getTime() - now) / 86_400_000));
  return { total, allowance, topup, resetsInDays, low: total >= 0 && total < 100, negative: total < 0 };
}

export const ACTIVITY_LABELS: Record<string, string> = {
  MONTHLY_GRANT: "Your monthly credits",
  TOPUP_PURCHASE: "Credits you bought",
  AI_USAGE: "AI help",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
};
