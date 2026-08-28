import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ensureCreditPeriod } from "@/lib/credits/ledger";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { SettingsShell } from "../../_components/SettingsShell";
import { PageHeader } from "../../_components/PageHeader";
import { BillingSection } from "../billing-section";

export default async function SubscriptionPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/subscription");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // Lazily grants the next monthly allowance if the current period has elapsed, so the
  // balance shown below is always current even without a cron job.
  const balance = await ensureCreditPeriod(session.user.id);

  const [user, recentActivity] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { subscriptionPlan: true } }),
    prisma.creditLedgerEntry.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <SettingsShell>
      <PageHeader eyebrow="Account" title="Subscription" subtitle="Your plan, credit balance, and recent usage." />
      <BillingSection
        plan={user.subscriptionPlan}
        allowanceBalance={balance.allowanceBalance}
        topupBalance={balance.topupBalance}
        allowanceResetAt={balance.allowanceResetAt.toISOString()}
        recentActivity={recentActivity.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amount: entry.amount,
          description: entry.description,
          createdAt: entry.createdAt.toISOString(),
        }))}
      />
    </SettingsShell>
  );
}
