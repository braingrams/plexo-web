import { NextRequest, NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto";
import { canUseHostManagedAi } from "@/lib/subscription";
import { resolveOrgContext } from "@/app/api/org/_context";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { ApiKey, User } from "@/lib/db/coreEntities";
import type { EntityItem } from "electrodb";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
type AiAccessMode = "SYSTEM" | "BYOK" | "HOST_MANAGED";

const PROVIDER_VALUES = new Set(["openai", "anthropic_claude", "google_gemini"]);
const TIER_VALUES = new Set<AiTier>(["AUTO", "BASIC", "MEDIUM", "HIGH"]);
const ACCESS_MODE_VALUES = new Set<AiAccessMode>(["SYSTEM", "BYOK", "HOST_MANAGED"]);

function serializeApiKey(record: EntityItem<typeof ApiKey>) {
  return {
    id: record.id,
    name: record.name,
    maskedKey: record.maskedKey,
    createdAt: record.createdAt,
    isActive: record.isActive,
    useAi: record.useAi,
    aiProvider: record.aiProvider,
    aiTier: record.aiTier,
    hasAiApiKey: !!record.aiApiKey,
    aiAccessMode: record.aiAccessMode,
    hostAuthWebhookUrl: record.hostAuthWebhookUrl,
    hasHostWebhookSecret: !!record.hostWebhookSecret,
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const permissionError = requirePermission(ctx.role, { apiKey: ["manage"] });
  if (permissionError) return permissionError;

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: "revoke";
    useAi?: boolean;
    aiProvider?: string;
    aiTier?: AiTier;
    aiApiKey?: string;
    aiAccessMode?: AiAccessMode;
    hostAuthWebhookUrl?: string;
    hostWebhookSecret?: string;
  };

  const { data: existingKey } = await ApiKey.get({ organizationId: ctx.organizationId, id: params.id }).go();

  if (!existingKey) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  if ("action" in body && body.action === "revoke") {
    await ApiKey.remove({ organizationId: ctx.organizationId, id: existingKey.id }).go();
    return NextResponse.json({ success: true, deletedId: existingKey.id });
  }

  const useAi = typeof body.useAi === "boolean" ? body.useAi : existingKey.useAi;
  const aiProvider = typeof body.aiProvider === "string" ? body.aiProvider : existingKey.aiProvider;
  const aiTier = typeof body.aiTier === "string" ? body.aiTier : existingKey.aiTier;

  // aiApiKey/hostWebhookSecret are write-only: the client only sends them when the
  // user actually typed a replacement. An empty string clears the stored value;
  // omitting the field leaves it untouched. Never round-tripped back to the client
  // — see serializeApiKey.
  let aiApiKey = existingKey.aiApiKey;
  let clearAiApiKey = false;
  if (typeof body.aiApiKey === "string") {
    const trimmed = body.aiApiKey.trim();
    if (trimmed) {
      aiApiKey = encryptSecret(trimmed);
    } else {
      aiApiKey = undefined;
      clearAiApiKey = true;
    }
  }

  let hostWebhookSecret = existingKey.hostWebhookSecret;
  let clearHostWebhookSecret = false;
  if (typeof body.hostWebhookSecret === "string") {
    const trimmed = body.hostWebhookSecret.trim();
    if (trimmed) {
      hostWebhookSecret = encryptSecret(trimmed);
    } else {
      hostWebhookSecret = undefined;
      clearHostWebhookSecret = true;
    }
  }

  const aiAccessMode =
    typeof body.aiAccessMode === "string" && ACCESS_MODE_VALUES.has(body.aiAccessMode)
      ? body.aiAccessMode
      : existingKey.aiAccessMode;

  let hostAuthWebhookUrl = existingKey.hostAuthWebhookUrl;
  let clearHostAuthWebhookUrl = false;
  if (typeof body.hostAuthWebhookUrl === "string") {
    const trimmed = body.hostAuthWebhookUrl.trim();
    if (trimmed) {
      hostAuthWebhookUrl = trimmed;
    } else {
      hostAuthWebhookUrl = undefined;
      clearHostAuthWebhookUrl = true;
    }
  }

  if (!PROVIDER_VALUES.has(aiProvider ?? "")) {
    return NextResponse.json({ error: "Invalid AI provider" }, { status: 400 });
  }

  if (!TIER_VALUES.has((aiTier ?? "AUTO") as AiTier)) {
    return NextResponse.json({ error: "Invalid AI tier" }, { status: 400 });
  }

  if (aiAccessMode === "HOST_MANAGED") {
    if (!hostAuthWebhookUrl || !hostWebhookSecret) {
      return NextResponse.json(
        { error: "Host-Managed AI access requires both a webhook URL and a webhook secret." },
        { status: 400 },
      );
    }
    if (!aiApiKey) {
      return NextResponse.json(
        { error: "Host-Managed AI access requires the account's own AI provider key. Plexo's system key is never used in this mode." },
        { status: 400 },
      );
    }

    const { data: owner } = await User.get({ id: existingKey.userId }).go();
    if (!owner) throw new Error(`ApiKey ${existingKey.id}'s owner user ${existingKey.userId} no longer exists`);
    if (!canUseHostManagedAi(owner.subscriptionPlan)) {
      return NextResponse.json(
        { error: "Host-Managed AI access requires the Ultra plan." },
        { status: 403 },
      );
    }
  }

  let patch = ApiKey.patch({ organizationId: ctx.organizationId, id: existingKey.id }).set({
    useAi,
    aiProvider,
    aiTier,
    ...(aiApiKey !== undefined ? { aiApiKey } : {}),
    aiAccessMode,
    ...(hostAuthWebhookUrl !== undefined ? { hostAuthWebhookUrl } : {}),
    ...(hostWebhookSecret !== undefined ? { hostWebhookSecret } : {}),
  });
  const toRemove: ("aiApiKey" | "hostAuthWebhookUrl" | "hostWebhookSecret")[] = [];
  if (clearAiApiKey) toRemove.push("aiApiKey");
  if (clearHostAuthWebhookUrl) toRemove.push("hostAuthWebhookUrl");
  if (clearHostWebhookSecret) toRemove.push("hostWebhookSecret");
  if (toRemove.length) patch = patch.remove(toRemove);
  await patch.go();

  const { data: updated } = await ApiKey.get({ organizationId: ctx.organizationId, id: existingKey.id }).go();
  if (!updated) throw new Error(`ApiKey ${existingKey.id} vanished immediately after being updated`);

  return NextResponse.json({ apiKey: serializeApiKey(updated) });
}
