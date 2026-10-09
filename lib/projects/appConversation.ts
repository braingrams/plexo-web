import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";
import { SolConversation, SolPreferences } from "@/lib/db/solEntities";

// Each person's SOL conversation for an app — the app editor's chat. Created on first use,
// bound to the app (SolConversation.appId) so every turn has the app in context.

export async function ensureAppConversation(input: { userId: string; organizationId: string; appId: string; appName: string }): Promise<EntityItem<typeof SolConversation>> {
  const { data: conversations } = await SolConversation.query.primary({ userId: input.userId }).go({ pages: "all" });
  const existing = conversations
    .filter((c) => c.appId === input.appId && c.status === "ACTIVE" && c.organizationId === input.organizationId)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  if (existing) return existing;

  const { data: prefs } = await SolPreferences.get({ userId: input.userId }).go();
  const now = new Date().toISOString();
  const created = {
    id: randomUUID(),
    userId: input.userId,
    organizationId: input.organizationId,
    title: `Building ${input.appName}`,
    // App building leans on the stronger model by default; the owner can switch per message.
    modelTier: (prefs?.defaultModelTier === "HIGH" ? "HIGH" : "MEDIUM") as "HIGH" | "MEDIUM",
    status: "ACTIVE" as const,
    messageCount: 0,
    appId: input.appId,
    createdAt: now,
    updatedAt: now,
  };
  await SolConversation.create(created).go();
  return created as EntityItem<typeof SolConversation>;
}
