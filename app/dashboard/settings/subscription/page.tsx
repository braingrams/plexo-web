import { ownerNextPrice } from "@/lib/billing/ownerNextPrice";
import { redirectIfV3 } from "@/lib/dashboardV3/settingsContext";
import { redirect } from "next/navigation";

import { ensureCreditPeriod } from "@/lib/db/ledgerOperations";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { CreditLedgerEntry } from "@/lib/db/ledgerEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

import { SettingsShell } from "../../_components/SettingsShell";
import { PageHeader } from "../../_components/PageHeader";
import { BillingSection } from "../billing-section";
import { PaymentHistory } from "../payment-history";
import { listPaymentsForUser } from "@/lib/billing/payments";
import { accessDaysLeft, canStartTrial, effectivePlan, paidAccess, storedPlan } from "@/lib/plan/entitlement";
import { PLAN_LABELS } from "@/lib/plan/plans";
import { loadPriceBook } from "@/lib/billing/priceBook";
import { formatMoney, planPrice, regionById, regionForCurrency } from "@/lib/billing/pricing";

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectIfV3("settings/subscription/page.tsx", "/dashboard/settings/plan", await searchParams);
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/subscription");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Lazily grants the next monthly allowance if the current period has elapsed, so the
  // balance shown below is always current even without a cron job.
  const balance = await ensureCreditPeriod(session.user.id);

  const [{ data: user }, { data: recentActivity }, payments] = await Promise.all([
    User.get({ id: session.user.id }).go(),
    CreditLedgerEntry.query.primary({ userId: session.user.id }).go({ order: "desc", limit: 10 }),
    listPaymentsForUser(session.user.id),
  ]);
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);

  const plan = effectivePlan(user);
  const access = plan === "FREE" ? null : paidAccess(user);
  const paying = !!access?.entitled && (access.basis === "SUBSCRIPTION" || access.basis === "SUBSCRIPTION_UNVERIFIED");
  const daysLeft = accessDaysLeft(user);
  const planName = PLAN_LABELS[plan];
  let planNote: { text: string; tone: "info" | "warning" } | null = null;
  if (access?.entitled && access.basis === "ADMIN_KEPT") {
    planNote = { text: `Your ${planName} plan is provided by Plexo — there's nothing to pay.`, tone: "info" };
  } else if (access?.entitled && (access.basis === "TRIAL" || access.basis === "GRANT") && daysLeft !== null) {
    const when = new Date(user.planAccessUntil!).toLocaleDateString("en-US", { day: "numeric", month: "long" });
    planNote = {
      text: `${access.basis === "TRIAL" ? `Your ${planName} trial` : `Your ${planName} access`} ends on ${when} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left). Subscribe to keep everything as it is — otherwise one site stays live with its homepage, and nothing is deleted.`,
      tone: daysLeft <= 3 ? "warning" : "info",
    };
  } else if (paying && user.subscriptionStatus === "PAST_DUE") {
    planNote = { text: `We couldn't take your last payment. Your plan stays on while we retry — update your card under ${user.subscriptionProvider === "PAYSTACK" ? "Change card" : "Manage subscription"}.`, tone: "warning" };
  } else if (paying && user.subscriptionCancelAtPeriodEnd && user.subscriptionPeriodEnd) {
    const when = new Date(user.subscriptionPeriodEnd).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
    planNote = { text: `Your ${planName} plan won't renew. Everything keeps working until ${when}; after that one site stays live with its homepage, and nothing is deleted.`, tone: "info" };
  } else if (plan === "FREE" && user.planDowngradedAt) {
    const before = PLAN_LABELS[storedPlan({ subscriptionPlan: user.planBeforeDowngrade, planVersion: user.planVersion })];
    planNote = { text: `Your ${before} plan has ended. Your other pages, sites and custom domains are saved, not deleted — upgrade and they're all back straight away.`, tone: "warning" };
  }

  // The 2026 plan move booked for the next renewal: which plan, when, and at what price.
  let scheduled: { plan: typeof plan; at: string | null; priceLabel: string | null } | null = null;
  if (paying && user.scheduledPlan) {
    const book = await loadPriceBook();
    const region = regionById(book, user.billingRegion) ?? regionForCurrency(book, user.billingCurrency ?? "USD");
    const interval = user.subscriptionInterval ?? "monthly";
    const amount = region ? planPrice(region, user.scheduledPlan, interval) : null;
    scheduled = {
      plan: user.scheduledPlan,
      at: user.subscriptionPeriodEnd ?? user.scheduledPlanAt ?? null,
      priceLabel: region && amount ? `${formatMoney(amount, region.currency)}/${interval === "yearly" ? "year" : "month"}` : null,
    };
  }

  return (
    <SettingsShell>
      <PageHeader eyebrow="Account" title="Subscription" subtitle="Your plan, credit balance, and recent usage." />
      <BillingSection
        plan={plan}
        paying={paying}
        planNote={planNote}
        trialAvailable={canStartTrial(user)}
        provider={user.subscriptionProvider ?? (user.stripeSubscriptionId ? "STRIPE" : null)}
        interval={user.subscriptionInterval ?? null}
        cancelAtPeriodEnd={!!user.subscriptionCancelAtPeriodEnd}
        scheduled={scheduled}
        priceNotice={paying && !user.subscriptionCancelAtPeriodEnd ? (await ownerNextPrice(user as never)).notice : null}
        allowanceBalance={balance.allowanceBalance}
        topupBalance={balance.topupBalance}
        allowanceResetAt={balance.allowanceResetAt}
        recentActivity={recentActivity.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amount: entry.amount,
          description: entry.description ?? "",
          createdAt: entry.createdAt ?? new Date().toISOString(),
        }))}
      />
      <PaymentHistory
        payments={payments.map((p) => ({
          id: p.id,
          paidAt: p.paidAt,
          description: p.description,
          detail: p.detail ?? null,
          amountCents: p.amountCents,
          refundedCents: p.refundedCents ?? 0,
          currency: p.currency,
          status: p.status,
          receiptNumber: p.receiptNumber ?? null,
          cardBrand: p.cardBrand ?? null,
          cardLast4: p.cardLast4 ?? null,
          failureReason: p.failureReason ?? null,
        }))}
        summary={{
          cardBrand: user.billingCardBrand ?? null,
          cardLast4: user.billingCardLast4 ?? null,
          cardExpMonth: user.billingCardExpMonth ?? null,
          cardExpYear: user.billingCardExpYear ?? null,
          renewsAt: paying && !user.subscriptionCancelAtPeriodEnd ? (user.subscriptionPeriodEnd ?? null) : null,
          endsAt: paying && user.subscriptionCancelAtPeriodEnd ? (user.subscriptionPeriodEnd ?? null) : null,
        }}
      />
    </SettingsShell>
  );
}
