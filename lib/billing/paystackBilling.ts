// Plan billing in local currency (NGN, GHS, KES, ZAR) through Plexo's OWN Paystack account —
// the same account and webhook (app/api/webhooks/paystack/platform) that Plexo-hosted
// Commerce payments use, told apart by metadata.kind / the plan on the charge.
//
// The flow, end to end:
//   1. Upgrade → POST /api/billing/checkout picks Paystack for the person's region and calls
//      startPaystackPlanCheckout: a transaction on the region's Paystack plan (found or made
//      from lib/billing/pricing.ts — paystackPlanCode). The dashboard opens Paystack's popup.
//   2. The popup's success → GET /api/billing/paystack/verify confirms the transaction with
//      Paystack and applies it (applyPaystackTransaction), so the upgrade shows immediately.
//      The charge.success webhook applies the same transaction too; both are idempotent.
//   3. Paystack then creates the subscription (subscription.create) — saved on the account
//      with its email token, which is what cancelling needs.
//   4. Each renewal: charge.success on the plan → the period moves on, a receipt goes out.
//      A failed renewal (invoice.payment_failed) → PAST_DUE and an email; a cancelled one
//      (subscription.not_renew / disable) → the plan runs to the end of the paid period, then
//      the normal plan lifecycle (lib/plan/lifecycle.ts) takes over, exactly as for Stripe.

import type { EntityItem } from "electrodb";

import { User, Member } from "@/lib/db/coreEntities";
import { Payment } from "@/lib/db/ledgerEntities";
import { grantPlanChangeAllowance, grantTopup } from "@/lib/db/ledgerOperations";
import { reconcileFunnelSlotsForOrg } from "@/lib/lms/funnelSlots";
import { allowancePlan, storedPlan } from "@/lib/plan/entitlement";
import { PLAN_LABELS, isPaidPlanId, planFields, CURRENT_PLAN_VERSION, type PaidPlanId } from "@/lib/plan/plans";
import {
  createPaystackPlan,
  disablePaystackSubscription,
  fetchPaystackSubscription,
  initializePaystackTransaction,
  listPaystackPlans,
  verifyPaystackTransaction,
  type PaystackTransaction,
} from "@/lib/paystack";
import { loadPriceBook } from "./priceBook";
import {
  DEFAULT_PRICE_BOOK,
  creditsForTopupAmount,
  paystackPlanName,
  planPriceMinor,
  regionById,
  regionForCurrency,
  topupPack,
  type BillingInterval,
  type PriceRegion,
  type TopupPackId,
} from "./pricing";
import { recordPaystackPayment, sendReceiptEmail } from "./payments";

type UserItem = EntityItem<typeof User>;

export const PAYSTACK_PLAN_KIND = "plexo_plan";
export const PAYSTACK_TOPUP_KIND = "plexo_topup";

export function platformPaystackSecretKey(): string | null {
  return process.env.PLATFORM_PAYSTACK_SECRET_KEY || null;
}

export function platformPaystackPublicKey(): string | null {
  return process.env.PLATFORM_PAYSTACK_PUBLIC_KEY || null;
}

function requireKey(): string {
  const key = platformPaystackSecretKey();
  if (!key) throw new Error("Paying in your local currency isn't available right now. Please try again in a little while, or contact support if it keeps happening.");
  return key;
}

// ── Plans ──────────────────────────────────────────────────────────────────────────────

const PLAN_NAME_RE = /^Plexo (Starter|Pro|Enterprise) (monthly|yearly) ([A-Z]{3}) /;

/** Reads one of our own Paystack plan names back ("Plexo Starter monthly NGN 3000"). */
export function parsePaystackPlanName(name: string | null | undefined): { plan: PaidPlanId; interval: BillingInterval; currency: string } | null {
  const m = PLAN_NAME_RE.exec(`${name ?? ""} `);
  if (!m) return null;
  const plan = m[1].toUpperCase();
  return isPaidPlanId(plan) ? { plan, interval: m[2] as BillingInterval, currency: m[3] } : null;
}

const planCodeCache = new Map<string, string>();

/**
 * The Paystack plan code for a plan/region/interval at today's price — found by its name, or
 * created the first time it's needed. The amount is part of the name, so changing a price in
 * lib/billing/pricing.ts makes a new Paystack plan (existing subscribers keep theirs).
 */
export async function paystackPlanCode(region: PriceRegion, plan: PaidPlanId, interval: BillingInterval, secretKey = requireKey()): Promise<string> {
  const name = paystackPlanName(region, plan, interval);
  const cached = planCodeCache.get(name);
  if (cached) return cached;
  for (let page = 1; page <= 10; page++) {
    const plans = await listPaystackPlans(secretKey, page);
    for (const p of plans) if (p.name) planCodeCache.set(p.name, p.plan_code);
    if (planCodeCache.has(name)) return planCodeCache.get(name)!;
    if (plans.length < 100) break;
  }
  const code = await createPaystackPlan({
    secretKey,
    name,
    amountMinor: planPriceMinor(region, plan, interval),
    currency: region.currency,
    interval: interval === "yearly" ? "annually" : "monthly",
    description: `Plexo ${PLAN_LABELS[plan]} plan, billed ${interval}`,
  });
  planCodeCache.set(name, code);
  return code;
}

// ── Starting a checkout ────────────────────────────────────────────────────────────────

export type PaystackCheckout = { provider: "PAYSTACK"; accessCode: string; authorizationUrl: string; reference: string; publicKey: string | null };

function newReference(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function startPaystackPlanCheckout(input: {
  user: Pick<UserItem, "id" | "email">;
  region: PriceRegion;
  plan: PaidPlanId;
  interval: BillingInterval;
  callbackUrl: string;
}): Promise<PaystackCheckout> {
  const secretKey = requireKey();
  const planCode = await paystackPlanCode(input.region, input.plan, input.interval, secretKey);
  const reference = newReference("plx_plan");
  const result = await initializePaystackTransaction({
    secretKey,
    email: input.user.email,
    amountMinor: planPriceMinor(input.region, input.plan, input.interval),
    currency: input.region.currency,
    reference,
    callbackUrl: input.callbackUrl,
    plan: planCode,
    metadata: {
      kind: PAYSTACK_PLAN_KIND,
      plexoUserId: input.user.id,
      plan: input.plan,
      planVersion: CURRENT_PLAN_VERSION,
      interval: input.interval,
      region: input.region.id,
    },
  });
  return { provider: "PAYSTACK", accessCode: result.accessCode, authorizationUrl: result.authorizationUrl, reference: result.reference, publicKey: platformPaystackPublicKey() };
}

export async function startPaystackTopupCheckout(input: {
  user: Pick<UserItem, "id" | "email">;
  region: PriceRegion;
  pack: TopupPackId;
  callbackUrl: string;
}): Promise<PaystackCheckout & { credits: number }> {
  const secretKey = requireKey();
  const offer = topupPack(input.region, input.pack);
  const reference = newReference("plx_topup");
  const result = await initializePaystackTransaction({
    secretKey,
    email: input.user.email,
    amountMinor: offer.amountMinor,
    currency: input.region.currency,
    reference,
    callbackUrl: input.callbackUrl,
    metadata: { kind: PAYSTACK_TOPUP_KIND, plexoUserId: input.user.id, pack: input.pack, credits: offer.credits, amountMinor: offer.amountMinor, region: input.region.id },
  });
  return { provider: "PAYSTACK", accessCode: result.accessCode, authorizationUrl: result.authorizationUrl, reference: result.reference, publicKey: platformPaystackPublicKey(), credits: offer.credits };
}

// ── Applying payments ──────────────────────────────────────────────────────────────────

type Metadata = Record<string, unknown>;

export function paystackMetadata(raw: unknown): Metadata {
  if (raw && typeof raw === "object") return raw as Metadata;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      return JSON.parse(raw) as Metadata;
    } catch {
      return {};
    }
  }
  return {};
}

export function addInterval(fromIso: string, interval: BillingInterval): string {
  const d = new Date(fromIso);
  if (interval === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

async function findUserByEmail(email: string | null | undefined): Promise<UserItem | null> {
  if (!email) return null;
  for (const candidate of new Set([email, email.toLowerCase()])) {
    const { data } = await User.query.byEmail({ email: candidate }).go();
    if (data[0]) {
      const { data: full } = await User.get({ id: data[0].id }).go();
      if (full) return full as UserItem;
    }
  }
  return null;
}

async function reconcileOwnedFunnelSlots(userId: string): Promise<void> {
  const { data: memberships } = await Member.query.byUser({ userId }).go({ pages: "all" });
  await Promise.all(
    memberships.filter((m) => m.role === "owner").map((m) => reconcileFunnelSlotsForOrg(m.organizationId).catch((err) => console.error("paystack billing: funnel slots", err))),
  );
}

export type ApplyResult = { applied: "plan" | "renewal" | "topup" | "none"; userId?: string; plan?: PaidPlanId };

/** Deps that tests replace (lifecycle pulls in a lot). */
export type ApplyDeps = { syncPlanLifecycle?: (userId: string) => Promise<unknown>; reconcilePriceMove?: (userId: string) => Promise<unknown> };

async function syncLifecycle(userId: string, deps: ApplyDeps): Promise<void> {
  const sync = deps.syncPlanLifecycle ?? (async (id: string) => (await import("@/lib/plan/lifecycle")).syncPlanLifecycle(id));
  await sync(userId).catch((err) => console.error(`plan lifecycle after Paystack payment failed for ${userId}`, err));
}

/**
 * Applies one successful Paystack transaction on Plexo's account — a first plan payment, a
 * renewal, or a credit top-up. Safe to call more than once for the same transaction (the
 * popup's verify call and the webhook both do).
 */
export async function applyPaystackTransaction(tx: PaystackTransaction, deps: ApplyDeps = {}): Promise<ApplyResult> {
  if (tx.status !== "success") return { applied: "none" };
  const meta = paystackMetadata(tx.metadata);
  const paidAt = tx.paid_at ?? new Date().toISOString();
  const card = { cardBrand: tx.authorization?.brand ?? tx.authorization?.card_type ?? null, cardLast4: tx.authorization?.last4 ?? null };

  // ── Credit top-up ──
  if (meta.kind === PAYSTACK_TOPUP_KIND && typeof meta.plexoUserId === "string") {
    // At the rate it was sold at (quoted in its metadata), so a later price edit can't change it.
    const quoted = Number(meta.credits ?? 0);
    const listMinor = Number(meta.amountMinor ?? 0);
    const book = await loadPriceBook();
    const region = regionById(book, meta.region as string) ?? regionForCurrency(book, tx.currency);
    const credits =
      quoted > 0 && listMinor > 0 ? Math.round((quoted * Math.min(tx.amount, listMinor)) / listMinor) : region ? creditsForTopupAmount(tx.amount / 100, tx.currency, region) : null;
    if (!credits) return { applied: "none" };
    await grantTopup(meta.plexoUserId, credits, `paystack-topup:${tx.reference}`, `Top-up purchase (${String(meta.pack ?? "credits")})`);
    const recorded = await recordPaystackPayment({ reference: tx.reference, userId: meta.plexoUserId, kind: "CREDIT_TOPUP", credits, amountMinor: tx.amount, currency: tx.currency, paidAt, email: tx.customer?.email, ...card });
    if (recorded?.becamePaid) await sendReceiptEmail(recorded.payment, { onceOnly: true }).catch((err) => console.error("paystack receipt failed", err));
    return { applied: "topup", userId: meta.plexoUserId };
  }

  // ── Plan: first payment (our metadata) or a renewal (the plan on the charge) ──
  const planOnCharge = tx.plan && typeof tx.plan === "object" ? (tx.plan as { name?: string; plan_code?: string }) : null;
  const fromName = parsePaystackPlanName(planOnCharge?.name);
  const isFirstPayment = meta.kind === PAYSTACK_PLAN_KIND && typeof meta.plexoUserId === "string";
  if (!isFirstPayment && !fromName) return { applied: "none" };

  const user = isFirstPayment
    ? (((await User.get({ id: meta.plexoUserId as string }).go()).data as UserItem | null) ?? null)
    : await findUserByEmail(tx.customer?.email);
  if (!user) {
    console.warn(`[paystack billing] payment ${tx.reference} has no Plexo account`);
    return { applied: "none" };
  }

  const plan: PaidPlanId | null = isFirstPayment && isPaidPlanId(meta.plan) ? (meta.plan as PaidPlanId) : (fromName?.plan ?? null);
  if (!plan) return { applied: "none" };
  const interval: BillingInterval = (meta.interval === "yearly" || meta.interval === "monthly" ? meta.interval : fromName?.interval) ?? "monthly";
  const book = await loadPriceBook();
  const region = regionById(book, meta.region as string) ?? regionById(book, user.billingRegion) ?? regionForCurrency(book, tx.currency) ?? regionForCurrency(DEFAULT_PRICE_BOOK, tx.currency)!;
  const periodEnd = addInterval(paidAt, interval);

  // Already applied (verify + webhook, or a webhook retry): nothing more to do.
  const { data: alreadyRecorded } = await Payment.get({ id: `paystack_${tx.reference}` }).go();
  if (alreadyRecorded && user.subscriptionProvider === "PAYSTACK" && storedPlan(user) === plan) {
    return { applied: isFirstPayment ? "plan" : "renewal", userId: user.id, plan };
  }

  const previousAllowance = allowancePlan(user);
  // Moving to a different plan on Paystack = a new subscription; the old one stops renewing now.
  const replacingOld =
    isFirstPayment && user.subscriptionProvider === "PAYSTACK" && user.subscriptionId && !user.subscriptionId.startsWith("pending:") && user.paystackEmailToken;
  if (replacingOld) {
    await disablePaystackSubscription({ secretKey: requireKey(), code: user.subscriptionId!, emailToken: user.paystackEmailToken! }).catch((err) =>
      console.error(`couldn't stop the previous Paystack subscription ${user.subscriptionId}`, err),
    );
  }
  const keepCode = !isFirstPayment && user.subscriptionProvider === "PAYSTACK" && user.subscriptionId ? user.subscriptionId : null;
  const laterEnd = user.subscriptionPeriodEnd && !replacingOld && Date.parse(user.subscriptionPeriodEnd) > Date.parse(periodEnd) ? user.subscriptionPeriodEnd : periodEnd;

  await User.patch({ id: user.id })
    .set({
      ...planFields(plan),
      subscriptionProvider: "PAYSTACK",
      subscriptionId: keepCode ?? `pending:${tx.reference}`,
      subscriptionStatus: "ACTIVE",
      subscriptionInterval: interval,
      subscriptionPeriodEnd: laterEnd,
      subscriptionCancelAtPeriodEnd: false,
      ...(isFirstPayment ? { subscriptionStartedAt: paidAt } : {}),
      // What this charge was, so the next renewal's price is known; a booked price move is done once it renews.
      subscriptionAmountMinor: tx.amount,
      ...(tx.customer?.customer_code ? { paystackCustomerCode: tx.customer.customer_code } : {}),
      billingCurrency: (tx.currency?.toUpperCase() as typeof region.currency) ?? region.currency,
      billingRegion: region.id,
      ...(user.billingRegionLockedAt ? {} : { billingRegionLockedAt: paidAt }),
      ...(card.cardLast4 ? { billingCardBrand: card.cardBrand ?? undefined, billingCardLast4: card.cardLast4 } : {}),
    })
    .remove(["pendingPlan", "planAccessUntil", "planAccessSource", "planAccessReminderSentAt", "scheduledPlan", "scheduledPlanAt", "nextAmountMinor", "nextAmountAt"])
    .go();

  if (previousAllowance !== plan) {
    await grantPlanChangeAllowance(user.id, plan).catch((err) => console.error("paystack billing: allowance", err));
    await reconcileOwnedFunnelSlots(user.id);
  }
  const recorded = await recordPaystackPayment({
    reference: tx.reference,
    userId: user.id,
    kind: "SUBSCRIPTION",
    plan,
    amountMinor: tx.amount,
    currency: tx.currency,
    paidAt,
    email: tx.customer?.email,
    periodEnd,
    ...card,
  });
  if (recorded?.becamePaid) await sendReceiptEmail(recorded.payment, { onceOnly: true }).catch((err) => console.error("paystack receipt failed", err));
  await syncLifecycle(user.id, deps);
  return { applied: isFirstPayment ? "plan" : "renewal", userId: user.id, plan };
}

/** Confirms a popup/redirect checkout with Paystack and applies it right away. */
export async function verifyAndApplyPaystackReference(reference: string, expectedUserId: string): Promise<ApplyResult & { status: string }> {
  const tx = await verifyPaystackTransaction(requireKey(), reference);
  const meta = paystackMetadata(tx.metadata);
  // Only ever your own checkout.
  if (meta.plexoUserId !== expectedUserId) return { applied: "none", status: "not_found" };
  if (tx.status !== "success") return { applied: "none", status: tx.status };
  return { ...(await applyPaystackTransaction(tx)), status: tx.status };
}

// ── Subscription events ────────────────────────────────────────────────────────────────

type SubscriptionData = {
  subscription_code?: string;
  email_token?: string;
  status?: string;
  next_payment_date?: string | null;
  plan?: { plan_code?: string; name?: string } | null;
  customer?: { email?: string; customer_code?: string } | null;
  subscription?: { subscription_code?: string; next_payment_date?: string | null } | null;
  amount?: number;
  currency?: string;
  next_notification?: string;
};

/**
 * Handles a Paystack event if it's about a Plexo plan or top-up. Returns false for anything
 * else (Commerce orders, donations), which the caller handles as before.
 */
export async function handlePaystackBillingEvent(
  event: { event?: string; data?: Record<string, unknown> },
  deps: ApplyDeps & { sendPaymentDeclinedEmail?: (user: UserItem, invoice: { amountMinor?: number | null; currency?: string | null; retryAt?: string | null }) => Promise<void> } = {},
): Promise<boolean> {
  const data = (event.data ?? {}) as SubscriptionData & Record<string, unknown>;
  switch (event.event) {
    case "charge.success": {
      const meta = paystackMetadata(data.metadata);
      const ours = meta.kind === PAYSTACK_PLAN_KIND || meta.kind === PAYSTACK_TOPUP_KIND || !!parsePaystackPlanName((data.plan as { name?: string } | null)?.name);
      if (!ours) return false;
      await applyPaystackTransaction(data as unknown as PaystackTransaction, deps);
      return true;
    }
    case "subscription.create": {
      const parsed = parsePaystackPlanName(data.plan?.name);
      if (!parsed || !data.subscription_code) return false;
      const user = await findUserByEmail(data.customer?.email);
      if (!user) return true;
      const previous = user.subscriptionProvider === "PAYSTACK" ? user.subscriptionId : null;
      // A different, older subscription still on record (the first payment's activation normally
      // stops it already) — stop it so nobody is billed twice.
      if (previous && !previous.startsWith("pending:") && previous !== data.subscription_code && user.paystackEmailToken) {
        await disablePaystackSubscription({ secretKey: requireKey(), code: previous, emailToken: user.paystackEmailToken }).catch((err) =>
          console.error(`couldn't stop superseded Paystack subscription ${previous}`, err),
        );
      }
      const previousAllowance = allowancePlan(user);
      await User.patch({ id: user.id })
        .set({
          ...planFields(parsed.plan),
          subscriptionProvider: "PAYSTACK",
          subscriptionId: data.subscription_code,
          subscriptionStatus: "ACTIVE",
          subscriptionInterval: parsed.interval,
          ...(data.email_token ? { paystackEmailToken: data.email_token } : {}),
          ...(data.customer?.customer_code ? { paystackCustomerCode: data.customer.customer_code } : {}),
          ...(data.next_payment_date ? { subscriptionPeriodEnd: new Date(data.next_payment_date).toISOString() } : {}),
          subscriptionCancelAtPeriodEnd: false,
        })
        .remove(["pendingPlan", "planAccessUntil", "planAccessSource"])
        .go();
      if (previousAllowance !== parsed.plan) await grantPlanChangeAllowance(user.id, parsed.plan).catch(() => undefined);
      await syncLifecycle(user.id, deps);
      return true;
    }
    case "subscription.not_renew":
    case "subscription.disable": {
      const code = data.subscription_code;
      if (!code) return false;
      const user = await findUserByEmail(data.customer?.email);
      if (!user || user.subscriptionProvider !== "PAYSTACK" || user.subscriptionId !== code) return !!parsePaystackPlanName(data.plan?.name);
      const periodEnd = user.subscriptionPeriodEnd ? Date.parse(user.subscriptionPeriodEnd) : NaN;
      const stillPaidFor = Number.isFinite(periodEnd) && periodEnd > Date.now();
      if (event.event === "subscription.not_renew" || stillPaidFor) {
        // Runs to the end of what was paid for; entitlement ends then (lib/plan/entitlement.ts).
        await User.patch({ id: user.id }).set({ subscriptionCancelAtPeriodEnd: true }).go();
      } else {
        await User.patch({ id: user.id }).set({ subscriptionStatus: "CANCELED", subscriptionCancelAtPeriodEnd: true }).go();
        await syncLifecycle(user.id, deps);
      }
      return true;
    }
    // Paystack's "this subscription is about to be charged" invoice (a few days before). Move the
    // subscriber to a changed price now if one is due — idempotent; the scheduled job is the backstop.
    case "invoice.create": {
      const user = await findUserByEmail(data.customer?.email);
      if (!user || !data.subscription?.subscription_code) return !!user;
      await (deps.reconcilePriceMove ?? (async (id: string) => (await import("./priceMoveLive")).reconcileOnePriceMove(id)))(user.id);
      return true;
    }
    case "invoice.payment_failed": {
      const code = data.subscription?.subscription_code;
      const user = await findUserByEmail(data.customer?.email);
      if (!user || !code || user.subscriptionId !== code) return !!code && !!user;
      await User.patch({ id: user.id }).set({ subscriptionStatus: "PAST_DUE" }).go();
      const notify = deps.sendPaymentDeclinedEmail ?? (async (u, inv) => (await import("@/lib/plan/lifecycle")).sendPaymentDeclinedEmail(u, inv));
      await notify(user, { amountMinor: data.amount ?? null, currency: (data.currency as string | undefined)?.toLowerCase() ?? null, retryAt: null }).catch((err) =>
        console.error("paystack declined email failed", err),
      );
      return true;
    }
    default:
      return false;
  }
}

// ── Cancelling, and checking in on quiet subscriptions ─────────────────────────────────

/** "Cancel plan" for a Paystack subscriber: stops renewals now; the plan runs to the end of what was paid for. */
export async function cancelPaystackPlan(user: UserItem): Promise<{ endsAt: string | null }> {
  if (user.subscriptionProvider !== "PAYSTACK" || !user.subscriptionId) throw new Error("There's no local-currency plan to cancel on this account.");
  if (!user.subscriptionId.startsWith("pending:")) {
    if (!user.paystackEmailToken) throw new Error("We couldn't cancel this plan automatically. Please contact support and we'll do it right away.");
    await disablePaystackSubscription({ secretKey: requireKey(), code: user.subscriptionId, emailToken: user.paystackEmailToken });
  }
  await User.patch({ id: user.id }).set({ subscriptionCancelAtPeriodEnd: true }).go();
  return { endsAt: user.subscriptionPeriodEnd ?? null };
}

/**
 * The hourly sweep's check on a Paystack subscription that should have renewed (period ended
 * more than a day ago with no renewal recorded): ask Paystack what happened.
 */
export async function verifyPaystackSubscription(user: UserItem, now: Date = new Date()): Promise<void> {
  if (user.subscriptionProvider !== "PAYSTACK" || !user.subscriptionId || user.subscriptionStatus === "CANCELED") return;
  const end = user.subscriptionPeriodEnd ? Date.parse(user.subscriptionPeriodEnd) : NaN;
  if (!Number.isFinite(end) || now.getTime() - end < 86_400_000) return;
  if (user.subscriptionCheckedAt && now.getTime() - Date.parse(user.subscriptionCheckedAt) < 86_400_000) return;
  const key = platformPaystackSecretKey();
  if (!key) return;
  if (user.subscriptionId.startsWith("pending:")) {
    // The subscription itself was never confirmed: the paid period is over, so it ends.
    await User.patch({ id: user.id }).set({ subscriptionStatus: "CANCELED", subscriptionCheckedAt: now.toISOString() }).go();
    return;
  }
  try {
    const sub = await fetchPaystackSubscription(key, user.subscriptionId);
    const next = sub.next_payment_date ? Date.parse(sub.next_payment_date) : NaN;
    if (sub.status === "active" && Number.isFinite(next) && next > now.getTime()) {
      await User.patch({ id: user.id }).set({ subscriptionStatus: "ACTIVE", subscriptionPeriodEnd: new Date(next).toISOString(), subscriptionCheckedAt: now.toISOString() }).go();
    } else if (sub.status === "attention" && now.getTime() - end < 14 * 86_400_000) {
      // Card trouble: keep the plan for up to two weeks while Paystack retries.
      await User.patch({ id: user.id }).set({ subscriptionStatus: "PAST_DUE", subscriptionCheckedAt: now.toISOString() }).go();
    } else {
      await User.patch({ id: user.id }).set({ subscriptionStatus: "CANCELED", subscriptionCheckedAt: now.toISOString() }).go();
    }
  } catch (err) {
    console.error(`paystack billing: couldn't check subscription for ${user.id}`, err);
    await User.patch({ id: user.id }).set({ subscriptionCheckedAt: now.toISOString() }).go();
  }
}
