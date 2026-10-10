import { redirect } from "next/navigation";

import { ensureCreditPeriod } from "@/lib/db/ledgerOperations";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { CreditLedgerEntry } from "@/lib/db/ledgerEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

import { SettingsShell } from "../../_components/SettingsShell";
import { PageHeader } from "../../_components/PageHeader";
import { BillingSection } from "../billing-section";
import { accessDaysLeft, canStartTrial, effectivePlan, paidAccess } from "@/lib/plan/entitlement";

export default async function SubscriptionPage() {
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

  const [{ data: user }, { data: recentActivity }] = await Promise.all([
    User.get({ id: session.user.id }).go(),
    CreditLedgerEntry.query.primary({ userId: session.user.id }).go({ order: "desc", limit: 10 }),
  ]);
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);

  const plan = effectivePlan(user);
  const access = plan === "FREE" ? null : paidAccess(user);
  const paying = !!access?.entitled && (access.basis === "SUBSCRIPTION" || access.basis === "SUBSCRIPTION_UNVERIFIED");
  const daysLeft = accessDaysLeft(user);
  const planName = plan === "ULTRA" ? "Ultra" : "Pro";
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
    planNote = { text: "We couldn't take your last payment. Your plan stays on while we retry — update your card under Manage subscription.", tone: "warning" };
  } else if (plan === "FREE" && user.planDowngradedAt) {
    const before = user.planBeforeDowngrade === "ULTRA" ? "Ultra" : "Pro";
    planNote = { text: `Your ${before} plan has ended. Your other pages, sites and custom domains are saved, not deleted — upgrade and they're all back straight away.`, tone: "warning" };
  }

  return (
    <SettingsShell>
      <PageHeader eyebrow="Account" title="Subscription" subtitle="Your plan, credit balance, and recent usage." />
      <BillingSection
        plan={plan}
        paying={paying}
        planNote={planNote}
        trialAvailable={canStartTrial(user)}
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
    </SettingsShell>
  );
}
