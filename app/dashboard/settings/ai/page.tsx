import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ApiKey, User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

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
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/ai");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const [{ data: allKeys }, { data: user }] = await Promise.all([
    ApiKey.query.primary({ organizationId: orgResolution.organizationId }).go(),
    User.get({ id: session.user.id }).go(),
  ]);
  if (!user) throw new Error(`Session user ${session.user.id} has no matching User record`);
  const apiKeys = allKeys
    .filter((k) => k.isActive)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <SettingsShell>
      <AiSettingsClient
        initialApiKeys={apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          isActive: k.isActive ?? true,
          useAi: k.useAi ?? false,
          aiProvider: k.aiProvider ?? "openai",
          aiTier: (k.aiTier ?? "AUTO") as AiTier,
          hasAiApiKey: !!k.aiApiKey,
          aiAccessMode: (k.aiAccessMode ?? "SYSTEM") as AiAccessMode,
          hostAuthWebhookUrl: k.hostAuthWebhookUrl ?? null,
          hasHostWebhookSecret: !!k.hostWebhookSecret,
        }))}
        isUltra={user.subscriptionPlan === "ULTRA"}
      />
    </SettingsShell>
  );
}
