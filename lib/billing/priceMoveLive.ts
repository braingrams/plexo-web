// The real wiring for lib/billing/priceMove.ts: DynamoDB, Stripe and Paystack. Used by the
// scheduled route (app/api/internal/price-moves) and by the pre-renewal webhooks.

import type Stripe from "stripe";

import { PriceChange, User } from "@/lib/db/coreEntities";
import { getStripe } from "@/lib/stripe";
import { disablePaystackSubscription, createPaystackSubscription, fetchPaystackSubscription, listPaystackSubscriptionsFor } from "@/lib/paystack";
import { stripePlanMetadata } from "./stripePlans";
import { ensureStripePlanPrice } from "./stripePrices";
import { paystackPlanCode, platformPaystackSecretKey } from "./paystackBilling";
import { loadPriceBook } from "./priceBook";
import { loadPriceChanges } from "./priceChangeStore";
import type { PriceChangeRow } from "./priceChanges";
export { loadPriceChanges };
import { MIN_LEAD_MS, WINDOW_DAYS, emptyReport, reconcileUser, runPriceMoves, type MoveDeps, type MoveReport, type MoveUser, type ProviderMove, type ProviderOutcome } from "./priceMove";
import type { BillingInterval, PriceGroup } from "./pricing";

/** The group with one plan/interval price overridden — so provider prices are made for the exact amount being moved to. */
function groupAt(group: PriceGroup, plan: ProviderMove["plan"], interval: BillingInterval, amount: number): PriceGroup {
  return interval === "yearly"
    ? { ...group, yearly: { ...group.yearly, [plan]: amount } }
    : { ...group, monthly: { ...group.monthly, [plan]: amount } };
}

async function stripeMove(input: ProviderMove): Promise<ProviderOutcome> {
  const { user, next, plan, interval } = input;
  const group = next.group!;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId ?? user.subscriptionId!);
  if (!["active", "trialing"].includes(sub.status) || sub.cancel_at_period_end) return { kind: "skipped", reason: "the subscription is not renewing" };
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end;
  if (!item || !periodEnd) return { kind: "skipped", reason: "no billing period found at Stripe" };
  if (item.price?.currency !== group.currency.toLowerCase()) return { kind: "skipped", reason: "they are billed in a different currency from their price list" };
  const lead = periodEnd * 1000 - input.now.getTime();
  if (lead < MIN_LEAD_MS.STRIPE || lead > WINDOW_DAYS * 24 * 3_600_000) return { kind: "skipped", reason: "renewal date at Stripe is outside the safe window; will retry" };
  const nextInterval = next.nextInterval ?? interval;
  const targetMinor = Math.round(next.nextAmount! * 100);
  const currentInterval: BillingInterval = item.price.recurring?.interval === "year" ? "yearly" : "monthly";
  if (currentInterval === nextInterval && item.price.unit_amount === targetMinor) return { kind: "already", amountMinor: targetMinor, detail: "already on the new price" };
  if (sub.schedule) return { kind: "skipped", reason: "the subscription already has a booked plan change; will retry once it has run" };

  if (!input.apply) return { kind: "moved", amountMinor: targetMinor, interval: nextInterval, detail: "dry run" };
  const priceId = await ensureStripePlanPrice(stripe, groupAt(group, plan, nextInterval, next.nextAmount!), plan, nextInterval);
  if (currentInterval === nextInterval) {
    // Same billing period: swap the price, no proration, no charge now. The next invoice uses it.
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "none",
      metadata: { ...sub.metadata, priceChangeId: next.changeId ?? "" },
    });
  } else {
    // Different period (yearly → monthly): only a schedule can start it at the renewal without billing now.
    const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        { items: [{ price: item.price.id, quantity: item.quantity ?? 1 }], start_date: schedule.phases[0].start_date, end_date: periodEnd, proration_behavior: "none" },
        {
          items: [{ price: priceId, quantity: 1 }],
          duration: { interval: nextInterval === "yearly" ? "year" : "month", interval_count: 1 },
          proration_behavior: "none",
          metadata: stripePlanMetadata({ plexoUserId: user.id, plan, interval: nextInterval, region: group.id }),
        },
      ],
    });
    // The account keeps its current period until the renewal; the webhook updates the interval when the phase starts.
    return { kind: "moved", amountMinor: targetMinor, interval: currentInterval, detail: `from ${new Date(periodEnd * 1000).toISOString().slice(0, 10)} billed ${nextInterval} at ${targetMinor / 100}` };
  }
  return { kind: "moved", amountMinor: targetMinor, interval: nextInterval, detail: `from ${new Date(periodEnd * 1000).toISOString().slice(0, 10)} at ${targetMinor / 100}` };
}

async function paystackMove(input: ProviderMove): Promise<ProviderOutcome> {
  const { user, next, plan, interval } = input;
  const group = next.group!;
  const key = platformPaystackSecretKey();
  if (!key) return { kind: "skipped", reason: "Paystack isn't configured here" };
  const code = user.subscriptionId!;
  const detail = await fetchPaystackSubscription(key, code);
  if (detail.status !== "active") return { kind: "skipped", reason: "the Paystack subscription is not active" };
  const nextPayment = detail.next_payment_date ? Date.parse(detail.next_payment_date) : NaN;
  if (!Number.isFinite(nextPayment)) return { kind: "skipped", reason: "Paystack has no next payment date for them" };
  const lead = nextPayment - input.now.getTime();
  if (lead < MIN_LEAD_MS.PAYSTACK || lead > WINDOW_DAYS * 24 * 3_600_000) return { kind: "skipped", reason: "renewal date at Paystack is outside the safe window; will retry" };
  const nextInterval = next.nextInterval ?? interval;
  const targetMinor = Math.round(next.nextAmount! * 100);
  const planCurrent = detail.plan?.amount;
  const currentInterval = detail.plan?.interval === "annually" ? "yearly" : "monthly";
  if (planCurrent === targetMinor && currentInterval === nextInterval) return { kind: "already", amountMinor: targetMinor, detail: "already on the new price" };
  if (!input.apply) return { kind: "moved", amountMinor: targetMinor, interval: nextInterval, detail: "dry run" };

  const planCode = await paystackPlanCode(groupAt(group, plan, nextInterval, next.nextAmount!), plan, nextInterval, key);
  const customer = user.paystackCustomerCode ?? detail.customer?.customer_code ?? user.email;
  // Did an earlier run already create the new subscription? Then use it — never a second one.
  const existing = (await listPaystackSubscriptionsFor(key, { customer, plan: planCode }).catch(() => [])).find((s) => s.status === "active" && s.subscription_code !== code);
  const created = existing
    ? { subscription_code: existing.subscription_code, email_token: existing.email_token }
    : await createPaystackSubscription({ secretKey: key, customer, plan: planCode, startDate: new Date(nextPayment).toISOString() });
  return {
    kind: "moved",
    amountMinor: targetMinor,
    interval: nextInterval,
    // Recorded BEFORE the old one is switched off, so a crash in between is finished next run.
    patch: { subscriptionId: created.subscription_code, paystackEmailToken: created.email_token, paystackRetireCode: code , paystackRetireToken: user.paystackEmailToken ?? "" },
    detail: `new Paystack subscription ${created.subscription_code} starts ${new Date(nextPayment).toISOString().slice(0, 10)} at ${targetMinor / 100}`,
  };
}

const liveMove = (input: ProviderMove): Promise<ProviderOutcome> => (input.provider === "STRIPE" ? stripeMove(input) : paystackMove(input));

/** Switches off the old Paystack subscription left over from a move, then forgets it. */
async function finishRetire(user: MoveUser): Promise<boolean> {
  const key = platformPaystackSecretKey();
  if (!key || !user.paystackRetireCode || !user.paystackRetireToken) return false;
  await disablePaystackSubscription({ secretKey: key, code: user.paystackRetireCode, emailToken: user.paystackRetireToken }).catch((err) => {
    // Already off is fine; anything else is retried next run.
    if (!/disabled|not found|inactive|cancel/i.test(String(err?.message))) throw err;
  });
  await User.patch({ id: user.id }).remove(["paystackRetireCode", "paystackRetireToken"]).go();
  return true;
}

async function* scanSubscribers(): AsyncIterable<MoveUser> {
  let cursor: string | null = null;
  do {
    const page: { data: MoveUser[]; cursor: string | null } = (await User.scan.go({ cursor })) as never;
    cursor = page.cursor;
    for (const u of page.data) if (u.subscriptionStatus === "ACTIVE" || u.subscriptionStatus === "TRIALING" || u.paystackRetireCode) yield u;
  } while (cursor);
}

async function liveDeps(apply: boolean, now: Date, log: (l: string) => void): Promise<MoveDeps> {
  const [book, changes] = await Promise.all([loadPriceBook({ fresh: true }), loadPriceChanges()]);
  return {
    now,
    apply,
    book,
    changes,
    listSubscribers: scanSubscribers,
    move: liveMove,
    patchUser: async (id, fields) => void (await User.patch({ id }).set(fields as never).go()),
    markStarted: async (changeId, at) => {
      const row = changes.find((c) => c.id === changeId);
      if (!row || row.startedAt) return;
      row.startedAt = at;
      await PriceChange.patch({ createdAt: row.createdAt, id: row.id }).set({ startedAt: at }).where((a, op) => op.notExists(a.startedAt)).go().catch(() => undefined);
    },
    finishRetire,
    log,
  };
}

/** The scheduled run. `apply: false` is a dry run: nothing is changed anywhere, every would-be move is logged. */
export async function runLivePriceMoves(opts: { apply: boolean; now?: Date }): Promise<MoveReport & { log: string[] }> {
  const lines: string[] = [];
  const log = (l: string) => {
    lines.push(l);
    console.log(`[price moves] ${l}`);
  };
  const report = await runPriceMoves(await liveDeps(opts.apply, opts.now ?? new Date(), log));
  return { ...report, log: lines.slice(0, 200) };
}

/** Just one person — what the providers' "renewal is coming" webhooks call. Never throws. */
export async function reconcileOnePriceMove(userId: string, opts: { now?: Date } = {}): Promise<MoveReport> {
  const report = emptyReport(true);
  try {
    const { data } = await User.get({ id: userId }).go();
    if (!data) return report;
    const deps = await liveDeps(true, opts.now ?? new Date(), (l) => console.log(`[price moves] ${l}`));
    report.scanned = 1;
    await reconcileUser(data as unknown as MoveUser, deps, report);
  } catch (err) {
    console.error(`[price moves] could not reconcile ${userId}`, err);
  }
  return report;
}

export type { Stripe };
