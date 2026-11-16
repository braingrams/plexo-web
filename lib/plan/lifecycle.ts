import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";

import { Member, User } from "@/lib/db/coreEntities";
import { PublishedDomain } from "@/lib/db/contentEntities";
import { grantPlanChangeAllowance } from "@/lib/db/ledgerOperations";
import { reconcileFunnelSlotsForOrg } from "@/lib/lms/funnelSlots";
import { slugify } from "@/lib/slugUtils";
import { RESERVED_SUBDOMAINS, SUBDOMAIN_REGEX } from "@/lib/sites/linkDomain";
import { getPagesDomain } from "@/server/pagesDomain";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildPaymentDeclinedEmail, buildPlanEndedEmail, buildPlanEndingSoonEmail, buildPlanRenewalSoonEmail } from "@/lib/mail/templates";
import { dueReminder } from "./reminders";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { getStripe } from "@/lib/stripe";
import { planFields } from "./plans";
import { planPriceMinor, regionById, regionForCurrency } from "@/lib/billing/pricing";
import { loadPriceBook } from "@/lib/billing/priceBook";
import {
  TRIAL_DAYS,
  isPaidPlan,
  paidAccess,
  planSyncAction,
  storedPlan,
  type DowngradeReason,
  type PlanSyncAction,
  type TrialPlan,
} from "./entitlement";
import { planFreeLimits, planRestore, type PlanSite } from "./siteLimits";
import { inBatches, listGovernedSites, setDomainPlanDisabled, setPagePublishFlags, type GovernedSite } from "./sitesStore";

// The plan lifecycle: what happens to an account's sites when its paid plan ends, and how
// everything comes back when it's paid for (or granted) again.
//
// Every trigger — a Stripe webhook, the trial running out, the admin console, the hourly
// sweep, a visitor or the owner simply showing up — only changes FACTS on the User row
// (plan, subscription status, access end date). syncPlanLifecycle then derives what's owed
// from those facts (entitlement.ts planSyncAction) and converges the sites to match. So no
// trigger can leave things half-done: whatever runs next finishes the job.
//
// Never deletes anything. A downgrade unpublishes pages and switches addresses off, marking
// each one (planArchivedAt / planDisabledAt); a restore undoes exactly those marks.

type UserItem = EntityItem<typeof User>;

const LEASE_MS = 90_000;
const MAX_CONVERGE_STEPS = 3;

function isConditionalCheckFailure(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } };
  return e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException";
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function claimLease(userId: string, now: Date): Promise<boolean> {
  try {
    await User.patch({ id: userId })
      .set({ planSyncLockUntil: new Date(now.getTime() + LEASE_MS).toISOString() })
      .where((attr, op) => `${op.notExists(attr.planSyncLockUntil)} OR ${op.lt(attr.planSyncLockUntil, now.toISOString())}`)
      .go();
    return true;
  } catch (err) {
    if (isConditionalCheckFailure(err)) return false; // someone else is already on it
    throw err;
  }
}

async function releaseLease(userId: string): Promise<void> {
  await User.patch({ id: userId }).remove(["planSyncLockUntil"]).go().catch((err) => console.error("plan lifecycle: lease release failed", err));
}

/**
 * Brings an account's sites in line with its plan. Safe to call from anywhere, any number
 * of times: it does nothing when nothing is owed, and only one caller works on an account
 * at a time (the others return immediately — the one holding the lease re-reads the
 * account before it finishes, so a change made meanwhile is never missed).
 * Returns the steps it took.
 */
export async function syncPlanLifecycle(userId: string, now: Date = new Date()): Promise<PlanSyncAction[]> {
  const { data: first } = await User.get({ id: userId }).go();
  if (!first || !planSyncAction(first, now)) return [];
  if (!(await claimLease(userId, now))) return [];
  const steps: PlanSyncAction[] = [];
  try {
    for (let i = 0; i < MAX_CONVERGE_STEPS; i++) {
      const { data: user } = await User.get({ id: userId }).go();
      const action = user ? planSyncAction(user, now) : null;
      if (!user || !action) break;
      if (action === "downgrade") await downgrade(user, now);
      else if (action === "restore") await restore(user);
      else await enforceFree(user, now);
      steps.push(action);
    }
  } finally {
    await releaseLease(userId);
  }
  return steps;
}

// ── downgrade ─────────────────────────────────────────────────────────────────────────

async function downgrade(user: UserItem, now: Date): Promise<void> {
  const access = paidAccess(user, now);
  const reason: DowngradeReason = access.entitled ? "ADMIN" : access.reason;
  const before = storedPlan(user);
  const previousPlan = before === "FREE" ? "STARTER" : before;
  await User.patch({ id: user.id })
    .set({ ...planFields("FREE"), planDowngradedAt: now.toISOString(), planDowngradeReason: reason, planBeforeDowngrade: previousPlan })
    // freeLimitsAppliedAt is cleared so the very next step applies Free's limits afresh.
    .remove(["planAccessUntil", "planAccessSource", "pendingPlan", "freeLimitsAppliedAt", "planAccessReminderSentAt"])
    .go();
  await grantPlanChangeAllowance(user.id, "FREE").catch((err) => console.error("plan lifecycle: allowance reset failed", err));
  const summary = await applyFreePlanLimits(user.id, { now });
  await reconcileOwnedFunnelSlots(user.id);
  await notifyPlanEnded(user, previousPlan, reason, summary);
}

// ── Free's limits ─────────────────────────────────────────────────────────────────────

export type FreeLimitsSummary = {
  keptSite: { id: string; name: string; address: string | null } | null;
  offlineSiteCount: number;
  archivedPageCount: number;
  pausedCustomDomainCount: number;
  changed: boolean;
};

async function enforceFree(user: UserItem, now: Date): Promise<void> {
  const summary = await applyFreePlanLimits(user.id, { now });
  // An account moved to Free by an admin, or already on Free when enforcement arrived, is
  // told what changed too — but only if something actually did.
  if (summary.changed) {
    await notifyPlanEnded(user, user.planBeforeDowngrade ? storedPlanOf(user.planBeforeDowngrade, user.planVersion) : "FREE", user.planDowngradeReason ?? "ADMIN", summary);
  }
}

/**
 * Free: one live site (the most recently edited, or `keepSiteId`), homepage only, on a
 * Plexo address. Everything else is unpublished or switched off — never deleted.
 */
export async function applyFreePlanLimits(
  userId: string,
  opts: { now?: Date; keepSiteId?: string } = {},
): Promise<FreeLimitsSummary> {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString();
  const sites = await listGovernedSites(userId);
  const changes = planFreeLimits(sites, opts.keepSiteId);
  const kept = sites.find((s) => s.id === changes.keptSiteId) ?? null;

  await inBatches(changes.disableDomainIds, 10, (ref) => setDomainPlanDisabled(ref, stamp));
  await inBatches(changes.enableDomainIds, 10, (ref) => setDomainPlanDisabled(ref, null));
  await inBatches(changes.archivePageIds, 10, (id) => setPagePublishFlags(id, false, stamp));

  let fallback: string | null = null;
  if (kept && changes.needsFallbackSubdomain) fallback = await createFallbackSubdomain(kept, userId);

  await User.patch({ id: userId }).set({ freeLimitsAppliedAt: stamp }).go();

  const disabled = new Set(changes.disableDomainIds.map((d) => d.id));
  const keptAddress =
    fallback ??
    kept?.domains.find((d) => d.type === "SUBDOMAIN" && d.active !== false && (!d.planDisabledAt || changes.enableDomainIds.some((e) => e.id === d.id)) && !disabled.has(d.id))?.domain ??
    null;
  const offlineSiteCount = new Set(
    sites.filter((s) => s.id !== kept?.id && s.domains.some((d) => disabled.has(d.id))).map((s) => s.id),
  ).size;
  const pausedCustomDomainCount = sites.flatMap((s) => s.domains).filter((d) => d.type === "CUSTOM" && disabled.has(d.id)).length;
  return {
    keptSite: kept ? { id: kept.id, name: kept.name, address: keptAddress } : null,
    offlineSiteCount,
    archivedPageCount: changes.archivePageIds.length,
    pausedCustomDomainCount,
    changed: changes.disableDomainIds.length + changes.archivePageIds.length + (fallback ? 1 : 0) > 0,
  };
}

/** A working Plexo address for the site Free keeps live, when its only addresses were custom domains. */
async function createFallbackSubdomain(site: PlanSite & { organizationId: string }, userId: string): Promise<string | null> {
  const pagesDomain = getPagesDomain();
  const base = (slugify(site.name).replace(/-{2,}/g, "-").slice(0, 40).replace(/-+$/, "") || "site");
  const safeBase = RESERVED_SUBDOMAINS.has(base) || !SUBDOMAIN_REGEX.test(base) ? `${base}-site`.replace(/^-+/, "") : base;
  const candidates = [safeBase, ...Array.from({ length: 4 }, () => `${safeBase}-${Math.random().toString(36).slice(2, 7)}`)];
  for (const sub of candidates) {
    if (!SUBDOMAIN_REGEX.test(sub)) continue;
    const domain = `${sub}.${pagesDomain}`;
    const { data: taken } = await PublishedDomain.query.byDomain({ domain }).go({ pages: "all" });
    if (taken.length) continue;
    try {
      await PublishedDomain.create({
        id: randomUUID(),
        userId,
        organizationId: site.organizationId,
        templateId: site.id,
        domain,
        type: "SUBDOMAIN",
        planFallback: true,
      }).go();
      return domain;
    } catch (err) {
      if (!isConditionalCheckFailure(err)) throw err;
    }
  }
  console.error(`plan lifecycle: couldn't find a free address for site ${site.id}`);
  return null;
}

// ── restore ───────────────────────────────────────────────────────────────────────────

/** Paid again (or granted by an admin): every page, site and custom domain the plan took offline comes back. */
async function restore(user: UserItem): Promise<void> {
  const sites = await listGovernedSites(user.id);
  const changes = planRestore(sites);
  await inBatches(changes.enableDomainIds, 10, (ref) => setDomainPlanDisabled(ref, null));
  await inBatches(changes.republishPageIds, 10, (id) => setPagePublishFlags(id, true, null));
  await User.patch({ id: user.id }).remove(["planDowngradedAt", "planDowngradeReason", "planBeforeDowngrade", "freeLimitsAppliedAt"]).go();
  await reconcileOwnedFunnelSlots(user.id);
}

// ── switching which site Free keeps live ──────────────────────────────────────────────

export class PlanLifecycleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** On Free: make `templateId` the one live site (the current one goes offline). */
export async function makeSiteLive(userId: string, templateId: string): Promise<FreeLimitsSummary> {
  const sites = await listGovernedSites(userId);
  if (!sites.some((s) => s.id === templateId)) throw new PlanLifecycleError("That site isn't one you can put live.", 404);
  return applyFreePlanLimits(userId, { keepSiteId: templateId });
}

/** The sites this account's plan governs — for the dashboard's plan screens. */
export async function governedSites(userId: string): Promise<GovernedSite[]> {
  return listGovernedSites(userId);
}

// ── trial ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the one free trial an account gets: Starter or Pro for TRIAL_DAYS, no card. Custom
 * domains, live payments and white-label wait for the first payment, and the trial adds no
 * AI credits (lib/plan/entitlement.ts isOnTrial/allowancePlan). When it ends without a
 * subscription, the normal downgrade runs.
 */
export async function startTrial(userId: string, plan: TrialPlan, now: Date = new Date()): Promise<{ endsAt: string }> {
  const { data: user } = await User.get({ id: userId }).go();
  if (!user) throw new PlanLifecycleError("Account not found.", 404);
  if (user.trialStartedAt) throw new PlanLifecycleError("You've already used your free trial. Choose a plan to keep going.", 409);
  if (isPaidPlan(user.subscriptionPlan) && paidAccess(user, now).entitled) {
    throw new PlanLifecycleError("You're already on a paid plan.", 409);
  }
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
  try {
    await User.patch({ id: userId })
      .set({
        ...planFields(plan),
        planAccessUntil: endsAt,
        planAccessSource: "TRIAL",
        trialStartedAt: now.toISOString(),
        trialOfferSeenAt: user.trialOfferSeenAt ?? now.toISOString(),
      })
      .remove(["pendingPlan", "planAccessReminderSentAt"])
      .where((attr, op) => op.notExists(attr.trialStartedAt))
      .go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) throw new PlanLifecycleError("You've already used your free trial. Choose a plan to keep going.", 409);
    throw err;
  }
  // An account coming back from an earlier downgrade gets its sites back for the trial.
  await syncPlanLifecycle(userId, now);
  return { endsAt };
}

function storedPlanOf(value: string, planVersion: number | null | undefined): string {
  return storedPlan({ subscriptionPlan: value, planVersion });
}

// ── Stripe facts ──────────────────────────────────────────────────────────────────────

export type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED";

export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    // Stripe is still retrying the card (past_due), or the first payment needs the
    // customer to finish authenticating (incomplete) — keep the plan meanwhile.
    case "past_due":
    case "incomplete":
      return "PAST_DUE";
    default:
      return "CANCELED"; // canceled, unpaid, incomplete_expired, paused
  }
}

/** A subscription recorded before statuses were tracked: ask Stripe once a day whether it's still paying. */
export async function verifyStripeSubscription(user: UserItem, now: Date = new Date()): Promise<void> {
  if (!user.stripeSubscriptionId || user.subscriptionStatus || user.subscriptionProvider === "PAYSTACK" || !process.env.STRIPE_SECRET_KEY) return;
  if (user.subscriptionCheckedAt && now.getTime() - Date.parse(user.subscriptionCheckedAt) < 86_400_000) return;
  let status: SubscriptionStatus;
  try {
    const sub = await getStripe().subscriptions.retrieve(user.stripeSubscriptionId);
    status = mapStripeStatus(sub.status);
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })?.code;
    if (code !== "resource_missing") {
      console.error(`plan lifecycle: couldn't check subscription for ${user.id}`, err);
      await User.patch({ id: user.id }).set({ subscriptionCheckedAt: now.toISOString() }).go();
      return;
    }
    status = "CANCELED";
  }
  await User.patch({ id: user.id }).set({ subscriptionStatus: status, subscriptionCheckedAt: now.toISOString() }).go();
}

// ── reminders & notices ───────────────────────────────────────────────────────────────

/**
 * "Your plan ends …" — a week before, a day before and on the day itself, once each per end date
 * (rules in reminders.ts). Covers free trials, admin grants with an end date, and subscribers who
 * have cancelled. Returns whether an email went out.
 */
export async function sendAccessEndingReminder(user: UserItem, now: Date = new Date()): Promise<boolean> {
  const due = dueReminder(user, now);
  if (!due) return false;
  // Claimed first, only if nothing else was recorded since we read the account, so two sweeps never both send it.
  try {
    await User.patch({ id: user.id })
      .set({ planExpiryReminderKey: due.key })
      .where((attr, op) => (user.planExpiryReminderKey ? op.eq(attr.planExpiryReminderKey, user.planExpiryReminderKey) : op.notExists(attr.planExpiryReminderKey)))
      .go();
  } catch (err) {
    if (isConditionalCheckFailure(err)) return false;
    throw err;
  }
  const plan = storedPlan(user);
  if (due.kind === "RENEWING") {
    const price = await currentSubscriptionPrice(user);
    const { subject, html } = buildPlanRenewalSoonEmail({ plan, renewsAt: due.endsAt, ...price, manageUrl: `${appUrl()}/dashboard/settings/subscription` });
    await sendEmail(user.email, subject, html);
    return true;
  }
  const { subject, html } = buildPlanEndingSoonEmail({
    plan,
    endsAt: due.endsAt,
    kind: due.kind,
    stage: due.stage,
    upgradeUrl: due.kind === "CANCELLING" ? `${appUrl()}/dashboard/settings/subscription` : `${appUrl()}/dashboard/settings/subscription?upgrade=${plan}`,
  });
  await sendEmail(user.email, subject, html);
  return true;
}

/** What the next renewal will charge — best effort; the email simply leaves the amount out if it can't be worked out. */
async function currentSubscriptionPrice(user: UserItem): Promise<{ amountMinor?: number; currency?: string }> {
  const nextPlan = user.scheduledPlan ?? storedPlan(user);
  if (user.subscriptionProvider === "PAYSTACK" || user.scheduledPlan) {
    // Paystack amounts (and a booked plan move) come straight from the price list.
    const book = await loadPriceBook();
    const region = regionById(book, user.billingRegion) ?? regionForCurrency(book, user.billingCurrency ?? "USD");
    if (nextPlan === "FREE" || !region) return {};
    return { amountMinor: planPriceMinor(region, nextPlan, user.subscriptionInterval ?? "monthly"), currency: region.currency.toLowerCase() };
  }
  const subscriptionId = user.stripeSubscriptionId;
  if (!subscriptionId || !process.env.STRIPE_SECRET_KEY) return {};
  try {
    const price = (await getStripe().subscriptions.retrieve(subscriptionId)).items.data[0]?.price;
    return price?.unit_amount != null ? { amountMinor: price.unit_amount, currency: price.currency } : {};
  } catch {
    return {};
  }
}

/** A renewal charge was declined (Stripe webhook). Plan and sites stay fully active while Stripe retries. */
export async function sendPaymentDeclinedEmail(
  user: Pick<UserItem, "email" | "subscriptionPlan" | "planVersion">,
  invoice: { amountMinor?: number | null; currency?: string | null; retryAt?: string | null },
): Promise<void> {
  const { subject, html } = buildPaymentDeclinedEmail({
    plan: storedPlan(user),
    ...invoice,
    manageUrl: `${appUrl()}/dashboard/settings/subscription`,
  });
  await sendEmail(user.email, subject, html);
}

async function notifyPlanEnded(user: UserItem, previousPlan: string, reason: DowngradeReason, summary: FreeLimitsSummary): Promise<void> {
  const subject = previousPlan === "FREE" ? "Your sites now follow the Free plan" : "Your Plexo plan has ended — nothing was deleted";
  await sendEmail(user.email, subject, buildPlanEndedEmail({
    previousPlan,
    reason,
    liveSiteName: summary.keptSite?.name ?? null,
    liveAddress: summary.keptSite?.address ?? null,
    offlineSiteCount: summary.offlineSiteCount,
    archivedPageCount: summary.archivedPageCount,
    customDomainCount: summary.pausedCustomDomainCount,
    upgradeUrl: `${appUrl()}/dashboard/settings/subscription`,
  }));
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    await sendMaildripEmail({ to, subject, html });
    logEmailDelivery({ kind: "maildrip", to, subject, status: "sent", context: "plan_lifecycle" });
  } catch (err) {
    console.error("plan lifecycle: email failed", err);
    logEmailDelivery({ kind: "maildrip", to, subject, status: "failed", errorMessage: err instanceof Error ? err.message : String(err), context: "plan_lifecycle" });
  }
}

/** Funnel slots follow the plan of each org's owner — reconcile the orgs this account owns. */
async function reconcileOwnedFunnelSlots(userId: string): Promise<void> {
  const { data: memberships } = await Member.query.byUser({ userId }).go({ pages: "all" });
  const owned = memberships.filter((m) => m.role === "owner").map((m) => m.organizationId);
  await Promise.all(owned.map((organizationId) => reconcileFunnelSlotsForOrg(organizationId).catch((err) => console.error("plan lifecycle: funnel slots", err))));
}
