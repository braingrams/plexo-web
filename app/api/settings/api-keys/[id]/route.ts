import { NextRequest, NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto";
import { canUseHostManagedAi } from "@/lib/subscription";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
type AiAccessMode = "SYSTEM" | "BYOK" | "HOST_MANAGED";

const PROVIDER_VALUES = new Set(["openai", "anthropic_claude", "google_gemini"]);
const TIER_VALUES = new Set<AiTier>(["AUTO", "BASIC", "MEDIUM", "HIGH"]);
const ACCESS_MODE_VALUES = new Set<AiAccessMode>(["SYSTEM", "BYOK", "HOST_MANAGED"]);

function serializeApiKey(record: {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
  aiApiKey: string | null;
  aiAccessMode: AiAccessMode;
  hostAuthWebhookUrl: string | null;
  hostWebhookSecret: string | null;
}) {
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
    aiAccessMode: record.aiAccessMode,
    hostAuthWebhookUrl: record.hostAuthWebhookUrl,
    hasHostWebhookSecret: !!record.hostWebhookSecret,
  };
}

// API keys belong to the organization — any teammate with apiKey.manage permission
// (Owner/Admin) may manage the whole org's keys, matching the list route's scoping.
async function getSessionOrgContext(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  const activeOrgId = (session.session as { activeOrganizationId?: string }).activeOrganizationId;
  const membership =
    (activeOrgId &&
      (await prisma.member.findUnique({
        where: { organizationId_userId: { organizationId: activeOrgId, userId: session.user.id } },
      }))) ||
    (await prisma.member.findFirst({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" } }));
  if (!membership) return null;

  return { userId: session.user.id, organizationId: membership.organizationId, role: membership.role };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getSessionOrgContext(request);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, ctx.role, { apiKey: ["manage"] });
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

  const existingKey = await prisma.apiKey.findFirst({
    where: {
      id: params.id,
      organizationId: ctx.organizationId,
    },
  });

  if (!existingKey) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  if ("action" in body && body.action === "revoke") {
    await prisma.apiKey.delete({
      where: { id: existingKey.id },
    });

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
  if (typeof body.aiApiKey === "string") {
    const trimmed = body.aiApiKey.trim();
    aiApiKey = trimmed ? encryptSecret(trimmed) : null;
  }

  let hostWebhookSecret = existingKey.hostWebhookSecret;
  if (typeof body.hostWebhookSecret === "string") {
    const trimmed = body.hostWebhookSecret.trim();
    hostWebhookSecret = trimmed ? encryptSecret(trimmed) : null;
  }

  const aiAccessMode =
    typeof body.aiAccessMode === "string" && ACCESS_MODE_VALUES.has(body.aiAccessMode)
      ? body.aiAccessMode
      : existingKey.aiAccessMode;

  const hostAuthWebhookUrl =
    typeof body.hostAuthWebhookUrl === "string" ? body.hostAuthWebhookUrl.trim() || null : existingKey.hostAuthWebhookUrl;

  if (!PROVIDER_VALUES.has(aiProvider)) {
    return NextResponse.json({ error: "Invalid AI provider" }, { status: 400 });
  }

  if (!TIER_VALUES.has(aiTier)) {
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

    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: existingKey.userId },
      select: { subscriptionPlan: true },
    });
    if (!canUseHostManagedAi(owner.subscriptionPlan)) {
      return NextResponse.json(
        { error: "Host-Managed AI access requires the Ultra plan." },
        { status: 403 },
      );
    }
  }

  const updated = await prisma.apiKey.update({
    where: { id: existingKey.id },
    data: {
      useAi,
      aiProvider,
      aiTier,
      aiApiKey,
      aiAccessMode,
      hostAuthWebhookUrl,
      hostWebhookSecret,
    },
  });

  return NextResponse.json({ apiKey: serializeApiKey(updated) });
}
