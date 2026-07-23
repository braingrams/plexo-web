import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ensureCreditPeriod } from "@/lib/credits/ledger";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

import { SettingsClient } from "./settings-client";

type SettingsApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
  hasAiApiKey: boolean;
};

function serializeApiKey(record: {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
  aiApiKey: string | null;
}): SettingsApiKey {
  return {
    id: record.id,
    name: record.name,
    maskedKey: record.maskedKey,
    createdAt: record.createdAt.toISOString(),
    isActive: record.isActive,
    useAi: record.useAi,
    aiProvider: record.aiProvider,
    aiTier: record.aiTier,
    hasAiApiKey: !!record.aiApiKey,
  };
}

export default async function DashboardSettingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings");
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: {
      userId: session.user.id,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Lazily grants the next monthly allowance if the current period has elapsed,
  // so the balance shown below is always current even without a cron job.
  const balance = await ensureCreditPeriod(session.user.id);

  const [user, recentActivity] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { subscriptionPlan: true, manageLandingPagePublishing: true },
    }),
    prisma.creditLedgerEntry.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <div style={{ padding: "2rem 8px", maxWidth: 1500, margin: "0 auto" }}>
      <SettingsClient
        initialApiKeys={apiKeys.map(serializeApiKey)}
        initialManageLandingPagePublishing={user.manageLandingPagePublishing}
        billing={{
          plan: user.subscriptionPlan,
          allowanceBalance: balance.allowanceBalance,
          topupBalance: balance.topupBalance,
          allowanceResetAt: balance.allowanceResetAt.toISOString(),
          recentActivity: recentActivity.map((entry) => ({
            id: entry.id,
            type: entry.type,
            amount: entry.amount,
            description: entry.description,
            createdAt: entry.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}
