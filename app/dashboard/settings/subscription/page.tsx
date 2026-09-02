import { redirect } from "next/navigation";

import { ensureCreditPeriod } from "@/lib/db/ledgerOperations";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { CreditLedgerEntry } from "@/lib/db/ledgerEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

import { SettingsShell } from "../../_components/SettingsShell";
import { PageHeader } from "../../_components/PageHeader";
import { BillingSection } from "../billing-section";

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

  return (
    <SettingsShell>
      <PageHeader eyebrow="Account" title="Subscription" subtitle="Your plan, credit balance, and recent usage." />
      <BillingSection
        plan={user.subscriptionPlan ?? "FREE"}
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
