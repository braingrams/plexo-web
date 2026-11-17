// Price changes and the people who already subscribe.
//
// A price change affects EVERYONE: new subscribers pay the new price straight away (the price
// book is live the moment it's saved); people who already subscribe move to it at their next
// renewal on or after the "effective date" — never mid-cycle, never prorated, never early.
// The admin chooses that date when saving prices (plexo-admin, Pricing page):
//   { when: "next_renewal" }                   effective right now → each person's next renewal
//   { when: "from_date", effectiveFrom: ISO }  effective from that day → the first renewal on/after it
//
// Every price-book save that changes an amount also writes ONE PriceChange row (the entity in
// lib/db/coreEntities.ts) holding the old and new amount for each plan/interval/price list that
// changed. Several can be pending at once; for a given renewal the change with the latest
// effective date that has taken effect by then wins.
//
// This file is pure and dependency-free: it's the single source of truth for "what does this
// person pay at their next renewal", used by the move job (lib/billing/priceMove.ts), by
// Settings > Plan, by the renewal reminder, and — as an identical copy — by plexo-admin to count
// who a change affects. Keep the two copies identical (plexo-web is the source of truth).

import type { PaidPlanId } from "@/lib/plan/plans";
import { formatMoney, regionById, resolvePriceRegion, type BillingCurrency, type BillingInterval, type BillingProvider, type PriceBook, type PriceGroup } from "./pricing";

export type ExistingSubscribers = { when: "next_renewal" } | { when: "from_date"; effectiveFrom: string };

export type PriceChangeEntry = {
  groupId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  provider: BillingProvider;
  /** Whole currency units, as in the price book. */
  oldAmount: number;
  /** null = this yearly price was removed (the plan is monthly-only from now on). Only yearly entries can be null. */
  newAmount: number | null;
};

export type PriceChangeRow = {
  id: string;
  /** The price-book version this save produced. */
  version: number;
  createdAt: string;
  createdByEmail?: string;
  existingSubscribers: ExistingSubscribers;
  /** Resolved from existingSubscribers: createdAt for next_renewal, the chosen date otherwise. */
  effectiveFrom: string;
  /**
   * Only matters when a yearly price was removed: true = people on that yearly plan move to the
   * monthly price at their next yearly renewal (the admin confirmed it when saving); false/absent =
   * they stay on their last yearly price and are reported, never moved.
   */
  moveRemovedYearlyToMonthly?: boolean;
  /** "cancelled" changes never move anyone. */
  status: "scheduled" | "cancelled";
  /** Set by the move job when the first subscriber is moved; after that the date can't change and it can't be cancelled. */
  startedAt?: string;
  cancelledAt?: string;
  entries: PriceChangeEntry[];
};

const PLANS: PaidPlanId[] = ["STARTER", "PRO", "ENTERPRISE"];
const INTERVALS: BillingInterval[] = ["monthly", "yearly"];

/** When a change takes effect for people who already subscribe. */
export function resolveEffectiveFrom(choice: ExistingSubscribers | undefined | null, createdAt: string): string {
  if (choice?.when === "from_date") {
    const t = Date.parse(choice.effectiveFrom);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return createdAt;
}

/**
 * The plan prices that differ between two price books, for price lists that exist in both and keep
 * their currency. A yearly price that is removed becomes an entry with newAmount null; a yearly
 * price that is newly offered is not an entry (nobody can already be on it).
 */
export function buildChangeEntries(before: PriceBook, after: PriceBook): PriceChangeEntry[] {
  const out: PriceChangeEntry[] = [];
  for (const g of after.groups) {
    const old = before.groups.find((b) => b.id === g.id);
    if (!old || old.currency !== g.currency) continue;
    for (const plan of PLANS) {
      for (const interval of INTERVALS) {
        const a = old[interval]?.[plan];
        const raw = g[interval]?.[plan];
        const b = typeof raw === "number" && raw > 0 ? raw : null;
        if (typeof a !== "number" || !(a > 0) || a === b) continue;
        if (b === null && interval === "monthly") continue;
        out.push({ groupId: g.id, plan, interval, currency: g.currency, provider: g.provider, oldAmount: a, newAmount: b });
      }
    }
  }
  return out;
}

/** Ordering of changes: effective date, then save order. */
export const changeKey = (c: Pick<PriceChangeRow, "effectiveFrom" | "version">): string => `${c.effectiveFrom}#${String(c.version).padStart(8, "0")}`;

export type SubscriberPriceInput = {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** The price list this person pays from (User.billingRegion). */
  groupId?: string | null;
  country?: string | null;
  currency?: BillingCurrency | string | null;
  /** When they subscribed — changes saved before this are already in the price they signed up at. */
  startedAt?: string | null;
  /** changeKey of the last change already applied to them. */
  appliedKey?: string | null;
  /** What each renewal charges now, in minor units, when known (stored, or read from the provider). */
  currentAmountMinor?: number | null;
  /** The next renewal (subscriptionPeriodEnd). */
  renewsAt?: string | null;
  cancelling?: boolean;
};

export type NextPriceReason = "change" | "no_change" | "yearly_removed" | "cancelling" | "no_renewal_date" | "group_removed" | "currency_changed";

export type NextPrice = {
  reason: NextPriceReason;
  currency: BillingCurrency | null;
  /** What the next renewal charges, whole units (null when unknown). */
  nextAmount: number | null;
  /** The billing period of the next renewal: differs from theirs only when a removed yearly price moves them to monthly. */
  nextInterval: BillingInterval | null;
  /** What they pay today, whole units (null when unknown). */
  currentAmount: number | null;
  /** True when the next renewal is at a different price from today's. */
  changes: boolean;
  /** The renewal on which the new price is first charged. */
  takesEffectAt: string | null;
  /** The effective date chosen for the change. */
  effectiveFrom: string | null;
  changeId: string | null;
  changeKey: string | null;
  group: PriceGroup | null;
};

const blank = (reason: NextPriceReason, extra: Partial<NextPrice> = {}): NextPrice => ({
  reason, currency: null, nextAmount: null, nextInterval: null, currentAmount: null, changes: false, takesEffectAt: null, effectiveFrom: null, changeId: null, changeKey: null, group: null, ...extra,
});

/** The price list a subscriber belongs to, or null when it has been removed. */
export function subscriberGroup(book: PriceBook, sub: Pick<SubscriberPriceInput, "groupId" | "country" | "currency">): PriceGroup | null {
  if (sub.groupId) return regionById(book, sub.groupId);
  return resolvePriceRegion(book, { billingCountry: sub.country, billingCurrency: sub.currency ?? undefined });
}

/**
 * What this person pays at their next renewal, and when that starts.
 * Rule: among changes saved after they subscribed (and not yet applied to them) that have taken
 * effect by their renewal date, the one with the latest effective date wins. A renewal before the
 * effective date is charged as before; on or after it, at the new price.
 */
export function priceAtNextRenewal(sub: SubscriberPriceInput, book: PriceBook, changes: PriceChangeRow[], now: Date): NextPrice {
  const group = subscriberGroup(book, sub);
  if (!group) return blank("group_removed");
  const currency = group.currency;
  if (sub.currency && String(sub.currency).toUpperCase() !== currency) return blank("currency_changed", { currency, group });
  const entriesFor = (c: PriceChangeRow) =>
    c.status === "cancelled" ? undefined : c.entries.find((e) => e.groupId === group.id && e.plan === sub.plan && e.interval === sub.interval && e.currency === currency);

  const applicable = changes
    .filter((c) => !!entriesFor(c))
    .filter((c) => !sub.startedAt || Date.parse(c.createdAt) > Date.parse(sub.startedAt))
    .filter((c) => !sub.appliedKey || changeKey(c) > sub.appliedKey)
    .sort((a, b) => changeKey(a).localeCompare(changeKey(b)));

  // Today's price: what the provider/user row says, else the price before the earliest pending change.
  const stored = typeof sub.currentAmountMinor === "number" && sub.currentAmountMinor > 0 ? sub.currentAmountMinor / 100 : null;
  const currentAmount = stored ?? (applicable[0] ? entriesFor(applicable[0])!.oldAmount : (group[sub.interval]?.[sub.plan] ?? null));

  if (sub.cancelling) return blank("cancelling", { currency, currentAmount, group });
  const renewMs = sub.renewsAt ? Date.parse(sub.renewsAt) : NaN;
  if (!Number.isFinite(renewMs)) return blank("no_renewal_date", { currency, currentAmount, group });
  // A renewal date already in the past (stale record) means "as soon as it renews".
  const at = Math.max(renewMs, now.getTime());

  const inForce = applicable.filter((c) => Date.parse(c.effectiveFrom) <= at);
  const winner = inForce[inForce.length - 1];
  if (!winner) {
    const upcoming = applicable.find((c) => Date.parse(c.effectiveFrom) > at);
    return blank("no_change", { currency, currentAmount, nextAmount: currentAmount, nextInterval: sub.interval, group, effectiveFrom: upcoming?.effectiveFrom ?? null });
  }
  const entry = entriesFor(winner)!;
  if (entry.newAmount === null) {
    // Yearly was removed. Only move them (to monthly) when the admin confirmed it; otherwise they stay as they are.
    const monthly = group.monthly[sub.plan];
    if (!winner.moveRemovedYearlyToMonthly || !(monthly > 0)) {
      return blank("yearly_removed", { currency, currentAmount, nextAmount: currentAmount, nextInterval: sub.interval, group, effectiveFrom: winner.effectiveFrom, changeId: winner.id, changeKey: changeKey(winner) });
    }
    return {
      reason: "change", currency, nextAmount: monthly, nextInterval: "monthly", currentAmount, changes: true,
      takesEffectAt: new Date(renewMs).toISOString(), effectiveFrom: winner.effectiveFrom, changeId: winner.id, changeKey: changeKey(winner), group,
    };
  }
  const nextAmount = entry.newAmount;
  const changed = currentAmount === null || Math.round(nextAmount * 100) !== Math.round(currentAmount * 100);
  return {
    reason: changed ? "change" : "no_change",
    currency,
    nextAmount,
    nextInterval: sub.interval,
    currentAmount,
    changes: changed,
    takesEffectAt: changed ? new Date(renewMs).toISOString() : null,
    effectiveFrom: winner.effectiveFrom,
    changeId: winner.id,
    changeKey: changeKey(winner),
    group,
  };
}

/** "Your price changes to $12/month on 5 December." — or null when nothing is changing. */
export function nextPriceNotice(next: NextPrice, interval: BillingInterval): string | null {
  if (!next.changes || next.nextAmount === null || !next.currency || !next.takesEffectAt) return null;
  interval = next.nextInterval ?? interval;
  const date = new Date(next.takesEffectAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `Your price changes to ${formatMoney(next.nextAmount, next.currency)}/${interval === "yearly" ? "year" : "month"} on ${date}.`;
}

// ── Who is affected (admin: the save step and the "email subscribers" draft) ───────────

export type ImpactSubscriber = SubscriberPriceInput & { id: string; email?: string | null };

export type ImpactRow = {
  groupId: string;
  groupName: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  oldAmount: number;
  newAmount: number;
  /** The period after the move (monthly when a removed yearly price moves people to monthly). */
  newInterval: BillingInterval;
  count: number;
  /** Earliest renewal on which anyone in this row is first charged the new price. */
  firstChargeAt: string | null;
};

/**
 * Counts who a set of changes would move, by price list and plan, and the first date anyone is
 * charged the new price. `subscribers` are the live, renewing subscriptions.
 */
export function summarizeImpact(
  subscribers: ImpactSubscriber[],
  book: PriceBook,
  changes: PriceChangeRow[],
  now: Date,
  /** Count only people this particular change decides (when several are pending). */
  onlyChangeId?: string,
): { rows: ImpactRow[]; total: number; firstChargeAt: string | null; subscriberIds: Record<string, string[]> } {
  const map = new Map<string, ImpactRow>();
  const ids: Record<string, string[]> = {};
  let total = 0;
  let first: string | null = null;
  for (const s of subscribers) {
    const next = priceAtNextRenewal(s, book, changes, now);
    if (onlyChangeId && next.changeId !== onlyChangeId) continue;
    if (!next.changes || !next.group || next.nextAmount === null || next.currentAmount === null || !next.currency || !next.takesEffectAt) continue;
    const key = `${next.group.id}|${s.plan}|${s.interval}`;
    const row = map.get(key) ?? {
      groupId: next.group.id, groupName: next.group.name, plan: s.plan, interval: s.interval, currency: next.currency,
      oldAmount: next.currentAmount, newAmount: next.nextAmount, newInterval: next.nextInterval ?? s.interval, count: 0, firstChargeAt: null,
    };
    row.count++;
    if (!row.firstChargeAt || next.takesEffectAt < row.firstChargeAt) row.firstChargeAt = next.takesEffectAt;
    map.set(key, row);
    (ids[key] ??= []).push(s.id);
    total++;
    if (!first || next.takesEffectAt < first) first = next.takesEffectAt;
  }
  return { rows: [...map.values()].sort((a, b) => a.groupName.localeCompare(b.groupName) || a.plan.localeCompare(b.plan)), total, firstChargeAt: first, subscriberIds: ids };
}

/** Builds the not-yet-saved change row for a proposed book, to preview its impact. */
export function previewChange(before: PriceBook, after: PriceBook, choice: ExistingSubscribers, now: Date, moveRemovedYearlyToMonthly = false): PriceChangeRow {
  const createdAt = now.toISOString();
  return { id: "preview", version: Number.MAX_SAFE_INTEGER - 1, createdAt, existingSubscribers: choice, effectiveFrom: resolveEffectiveFrom(choice, createdAt), status: "scheduled", moveRemovedYearlyToMonthly, entries: buildChangeEntries(before, after) };
}
