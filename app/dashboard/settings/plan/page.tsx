import { PLAN } from "@/lib/plan/plans";
import { redirect } from "next/navigation";
import { ensureCreditPeriod } from "@/lib/db/ledgerOperations";
import { CreditLedgerEntry } from "@/lib/db/ledgerEntities";
import { listPaymentsForUser } from "@/lib/billing/payments";
import { accessDaysLeft, canStartTrial, paidAccess } from "@/lib/plan/entitlement";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { billingPlanId } from "@/lib/dashboardV3/billingView";
import { listGovernedSites } from "@/lib/plan/sitesStore";
import { otherLiveSites } from "@/lib/plan/siteLimits";
import { CommerceProduct } from "@/lib/db/commerceEntities";
import { listMembers } from "@/server/orgDynamo";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { PlanSection } from "../../_v3/settings/PlanSection";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const ctx = await getV3SettingsContext("/dashboard/settings/plan");
  if (!ctx) redirect("/dashboard/settings/subscription");
  const { user, plan } = ctx;
  const balance = await ensureCreditPeriod(ctx.userId);
  const [{ data: recent }, payments] = await Promise.all([CreditLedgerEntry.query.primary({ userId: ctx.userId }).go({ order: "desc", limit: 10 }), listPaymentsForUser(ctx.userId)]);
  const access = plan === PLAN.FREE ? null : paidAccess(user);
  const paying = !!access?.entitled && (access.basis === "SUBSCRIPTION" || access.basis === "SUBSCRIPTION_UNVERIFIED");
  const basis = access?.entitled ? (access.basis === "SUBSCRIPTION_UNVERIFIED" ? "SUBSCRIPTION" : access.basis) : null;
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => fn().catch(() => fallback);
  const [sites, products, members] = await Promise.all([
    safe(async () => otherLiveSites(await listGovernedSites(ctx.userId), "").length, 0),
    safe(async () => (await CommerceProduct.query.byOrg({ organizationId: ctx.organizationId }).go({ pages: "all", attributes: ["id"] })).data.length, 0),
    safe(async () => (await listMembers(ctx.organizationId)).length, 1),
  ]);
  return (
    <SettingsPage current="plan" experience={ctx.experience}>
      <PlanSection
        state={{
          plan: billingPlanId(plan),
          paying,
          basis: basis as "TRIAL" | "GRANT" | "SUBSCRIPTION" | "ADMIN_KEPT" | null,
          daysLeft: accessDaysLeft(user),
          endsAt: paying && user.subscriptionCancelAtPeriodEnd ? (user.subscriptionPeriodEnd ?? null) : null,
          renewsAt: paying && !user.subscriptionCancelAtPeriodEnd ? (user.subscriptionPeriodEnd ?? null) : null,
          pastDue: paying && user.subscriptionStatus === "PAST_DUE",
        }}
        trialAvailable={canStartTrial(user)}
        allowanceBalance={balance.allowanceBalance}
        topupBalance={balance.topupBalance}
        allowanceResetAt={balance.allowanceResetAt}
        activity={recent.map((e) => ({ id: e.id, type: e.type, amount: e.amount, description: e.description ?? "", createdAt: e.createdAt ?? new Date().toISOString() }))}
        payments={payments.map((p) => ({ id: p.id, paidAt: p.paidAt, description: p.description, detail: p.detail ?? null, amountCents: p.amountCents, refundedCents: p.refundedCents ?? 0, currency: p.currency, status: p.status, receiptNumber: p.receiptNumber ?? null, cardLast4: p.cardLast4 ?? null, failureReason: p.failureReason ?? null }))}
        usage={{ sites, products, teammates: Math.max(0, members - 1) }}
        card={{ cardBrand: user.billingCardBrand ?? null, cardLast4: user.billingCardLast4 ?? null, cardExpMonth: user.billingCardExpMonth ?? null, cardExpYear: user.billingCardExpYear ?? null }}
      />
    </SettingsPage>
  );
}
