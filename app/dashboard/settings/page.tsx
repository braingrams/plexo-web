import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
  aiModel: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
};

function serializeApiKey(record: {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
  isActive: boolean;
  useAi: boolean;
  aiModel: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
}): SettingsApiKey {
  return {
    id: record.id,
    name: record.name,
    maskedKey: record.maskedKey,
    createdAt: record.createdAt.toISOString(),
    isActive: record.isActive,
    useAi: record.useAi,
    aiModel: record.aiModel,
    aiTier: record.aiTier,
  };
}

export default async function DashboardSettingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings");
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="auth-shell">
      <SettingsClient initialApiKeys={apiKeys.map(serializeApiKey)} />
    </main>
  );
}
