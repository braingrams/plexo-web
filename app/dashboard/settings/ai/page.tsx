import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { AiSettingsClient } from "./AiSettingsClient";
import { SettingsShell } from "../../_components/SettingsShell";

export type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
export type AiAccessMode = "SYSTEM" | "BYOK" | "HOST_MANAGED";
export type AiSettingsApiKey = {
  id: string;
  name: string;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
  hasAiApiKey: boolean;
  aiAccessMode: AiAccessMode;
  hostAuthWebhookUrl: string | null;
  hasHostWebhookSecret: boolean;
};

export default async function AiSettingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/ai");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [apiKeys, user] = await Promise.all([
    prisma.apiKey.findMany({
      where: { organizationId: orgResolution.organizationId, isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, isActive: true, useAi: true, aiProvider: true, aiTier: true,
        aiApiKey: true, aiAccessMode: true, hostAuthWebhookUrl: true, hostWebhookSecret: true,
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { subscriptionPlan: true } }),
  ]);

  return (
    <SettingsShell>
      <AiSettingsClient
        initialApiKeys={apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          isActive: k.isActive,
          useAi: k.useAi,
          aiProvider: k.aiProvider,
          aiTier: k.aiTier,
          hasAiApiKey: !!k.aiApiKey,
          aiAccessMode: k.aiAccessMode,
          hostAuthWebhookUrl: k.hostAuthWebhookUrl,
          hasHostWebhookSecret: !!k.hostWebhookSecret,
        }))}
        isUltra={user.subscriptionPlan === "ULTRA"}
      />
    </SettingsShell>
  );
}
