import { PLAN } from "@/lib/plan/plans";
// Moves people who already subscribe to a new price, at their next renewal — never mid-cycle,
// never prorated, never early (rules and data model: lib/billing/priceChanges.ts, docs/PRICE_CHANGES.md).
//
// An idempotent reconcile: for every live, renewing subscriber whose next renewal is inside the
// safe window (MIN_LEAD .. WINDOW_DAYS ahead), ask the pure rule what the renewal should charge;
// if that differs from what they pay now, ask the provider to charge the new price at that renewal:
//   • Stripe: change the subscription item's price with proration_behavior "none" (the current
//     period is already paid, so nothing is charged today; the next invoice uses the new price).
//     A change of billing period (a removed yearly price → monthly) uses a subscription schedule,
//     because switching period on a live Stripe subscription would bill immediately.
//   • Paystack: plans are fixed-amount, so we create a subscription on the new plan whose first
//     charge is the person's current period end, THEN switch the old one off. A crash between the
//     two is healed by the next run (and the double-charge guard: we look for the new subscription
//     before creating one, and the old one is switched off hours before it could charge).
// Run again and again: a person already on the new price is "already moved", nothing is repeated.
// A provider error leaves the person exactly as they were and is retried next run.
//
// Dependencies are injected (lib/billing/priceMoveLive.ts wires the real ones), so it's all testable.

import { priceAtNextRenewal, type NextPrice, type PriceChangeRow, type SubscriberPriceInput } from "./priceChanges";
import type { BillingCurrency, BillingInterval, BillingProvider, PriceBook } from "./pricing";
import { isPaidPlan, storedPlan } from "@/lib/plan/entitlement";
import type { PaidPlanId } from "@/lib/plan/plans";

export const WINDOW_DAYS = 5;
const HOUR = 3_600_000;
/** Too close to the charge to touch safely: the provider may already be building the invoice. */
export const MIN_LEAD_MS: Record<BillingProvider, number> = { STRIPE: 2 * HOUR, PAYSTACK: 12 * HOUR };

export type MoveUser = {
  id: string;
  email: string;
  subscriptionPlan?: string | null;
  planVersion?: number | null;
  subscriptionStatus?: string | null;
  subscriptionProvider?: string | null;
  subscriptionId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionInterval?: string | null;
  subscriptionPeriodEnd?: string | null;
  subscriptionCancelAtPeriodEnd?: boolean | null;
  subscriptionStartedAt?: string | null;
  subscriptionAmountMinor?: number | null;
  billingRegion?: string | null;
  billingCountry?: string | null;
  billingCurrency?: string | null;
  priceChangeKey?: string | null;
  nextAmountMinor?: number | null;
  nextAmountAt?: string | null;
  paystackRetireCode?: string | null;
  paystackRetireToken?: string | null;
  paystackCustomerCode?: string | null;
  paystackEmailToken?: string | null;
};

export type ProviderMove = { user: MoveUser; provider: BillingProvider; plan: PaidPlanId; interval: BillingInterval; next: NextPrice; apply: boolean; now: Date };
export type ProviderOutcome =
  | { kind: "moved"; amountMinor: number; interval: BillingInterval; patch?: Record<string, unknown>; detail: string }
  | { kind: "already"; amountMinor: number; detail: string }
  | { kind: "skipped"; reason: string };

export type MoveDeps = {
  now: Date;
  apply: boolean;
  book: PriceBook;
  changes: PriceChangeRow[];
  listSubscribers: () => AsyncIterable<MoveUser>;
  move: (input: ProviderMove) => Promise<ProviderOutcome>;
  patchUser: (id: string, fields: Record<string, unknown>) => Promise<void>;
  markStarted: (changeId: string, at: string) => Promise<void>;
  /** Paystack: finish switching off the old subscription of an earlier move. */
  finishRetire?: (user: MoveUser) => Promise<boolean>;
  log: (line: string) => void;
  windowDays?: number;
};

export type MoveReport = {
  apply: boolean;
  scanned: number;
  considered: number;
  moved: number;
  wouldMove: number;
  alreadyOnPrice: number;
  notYet: number;
  tooLate: number;
  failed: number;
  /** People we couldn't move, with why (removed price list, changed currency, yearly removed…). */
  left: { userId: string; email: string; reason: string }[];
};

export const emptyReport = (apply: boolean): MoveReport => ({ apply, scanned: 0, considered: 0, moved: 0, wouldMove: 0, alreadyOnPrice: 0, notYet: 0, tooLate: 0, failed: 0, left: [] });

export function toSubscriberInput(u: MoveUser): SubscriberPriceInput | null {
  const plan = storedPlan(u);
  if (plan === PLAN.FREE) return null;
  return {
    plan,
    interval: u.subscriptionInterval === "yearly" ? "yearly" : "monthly",
    groupId: u.billingRegion ?? null,
    country: u.billingCountry ?? null,
    currency: u.billingCurrency ?? null,
    startedAt: u.subscriptionStartedAt ?? null,
    appliedKey: u.priceChangeKey ?? null,
    currentAmountMinor: u.subscriptionAmountMinor ?? null,
    renewsAt: u.subscriptionPeriodEnd ?? null,
    cancelling: !!u.subscriptionCancelAtPeriodEnd,
  };
}

/** A live, renewing plan subscription we could move: not free, not a trial/grant, not cancelling, not pending. */
export function isMovable(u: MoveUser): BillingProvider | null {
  if (!isPaidPlan(u.subscriptionPlan)) return null;
  if (u.subscriptionStatus !== "ACTIVE" && u.subscriptionStatus !== "TRIALING") return null;
  const provider = u.subscriptionProvider ?? (u.stripeSubscriptionId ? "STRIPE" : null);
  if (provider !== "STRIPE" && provider !== "PAYSTACK") return null;
  const ref = u.subscriptionId || u.stripeSubscriptionId;
  if (!ref || ref.startsWith("pending:")) return null;
  return provider;
}

export async function reconcileUser(u: MoveUser, deps: MoveDeps, report: MoveReport): Promise<void> {
  const provider = isMovable(u);
  if (!provider) return;
  const { now, apply } = deps;
  if (apply && u.paystackRetireCode && deps.finishRetire) {
    // A previous run created the new Paystack subscription but didn't finish switching off the old one.
    await deps.finishRetire(u).catch((err) => deps.log(`could not finish switching off the old subscription for ${u.email}: ${errMsg(err)}`));
  }
  if (u.subscriptionCancelAtPeriodEnd) return; // leaving at the end of the period: no new price for them
  if (!deps.changes.some((c) => c.status === "scheduled")) return;
  const input = toSubscriberInput(u);
  if (!input) return;
  const next = priceAtNextRenewal(input, deps.book, deps.changes, now);
  if (next.reason === "group_removed" || next.reason === "currency_changed" || next.reason === "yearly_removed") {
    // Only worth reporting when a change is actually pending for them.
    if (deps.changes.some((c) => c.status === "scheduled" && c.entries.some((e) => e.plan === input.plan && e.interval === input.interval))) {
      report.left.push({ userId: u.id, email: u.email, reason: leftReason(next.reason) });
    }
    return;
  }
  if (!next.changes || !next.changeKey || !next.changeId) return;
  report.considered++;

  const renewMs = Date.parse(u.subscriptionPeriodEnd ?? "");
  const lead = renewMs - now.getTime();
  if (lead > (deps.windowDays ?? WINDOW_DAYS) * 24 * HOUR) {
    report.notYet++;
    return;
  }
  if (lead < MIN_LEAD_MS[provider]) {
    // Too close (or already renewed on the old price): they pay once more at the old price, then move.
    report.tooLate++;
    deps.log(`too close to renewal to change safely, will move next cycle: ${u.email}`);
    return;
  }

  try {
    const outcome = await deps.move({ user: u, provider, plan: input.plan, interval: input.interval, next, apply, now });
    if (outcome.kind === "skipped") {
      report.left.push({ userId: u.id, email: u.email, reason: outcome.reason });
      deps.log(`left alone ${u.email}: ${outcome.reason}`);
      return;
    }
    if (outcome.kind === "already") {
      report.alreadyOnPrice++;
      if (apply) await deps.patchUser(u.id, { priceChangeKey: next.changeKey, nextAmountMinor: outcome.amountMinor, nextAmountAt: u.subscriptionPeriodEnd });
      return;
    }
    if (!apply) {
      report.wouldMove++;
      deps.log(`would move ${u.email} (${provider}): ${next.currentAmount} → ${next.nextAmount} ${next.currency} ${next.nextInterval} from their renewal on ${next.takesEffectAt?.slice(0, 10)}`);
      return;
    }
    await deps.patchUser(u.id, { ...(outcome.patch ?? {}), priceChangeKey: next.changeKey, priceMovedAt: now.toISOString(), nextAmountMinor: outcome.amountMinor, nextAmountAt: u.subscriptionPeriodEnd });
    await deps.markStarted(next.changeId, now.toISOString());
    report.moved++;
    deps.log(`moved ${u.email} (${provider}): ${outcome.detail}`);
  } catch (err) {
    // Nothing is thrown away: they stay exactly as they were and the next run tries again.
    report.failed++;
    deps.log(`FAILED ${u.email}: ${errMsg(err)} — will retry next run`);
  }
}

export async function runPriceMoves(deps: MoveDeps): Promise<MoveReport> {
  const report = emptyReport(deps.apply);
  for await (const u of deps.listSubscribers()) {
    report.scanned++;
    await reconcileUser(u, deps, report);
  }
  return report;
}

function leftReason(r: NextPrice["reason"]): string {
  if (r === "group_removed") return "their price list was removed, so there is no new price to move them to";
  if (r === "currency_changed") return "their price list now charges in a different currency, so they stay on their own";
  return "yearly is no longer offered for their plan; they stay on their last yearly price (not moved to monthly)";
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type { BillingCurrency };
