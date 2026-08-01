import { createHash, randomInt } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomToken(length: number): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += TOKEN_ALPHABET[randomInt(0, TOKEN_ALPHABET.length)];
  }
  return output;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function maskApiKey(rawKey: string): string {
  return `${rawKey.slice(0, 11)}...${rawKey.slice(-4)}`;
}

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
  aiAccessMode: "SYSTEM" | "BYOK" | "HOST_MANAGED";
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

// API keys belong to the organization, not the individual member who happened to create
// one — any teammate with apiKey.manage permission (Owner/Admin) sees and can rotate the
// whole org's keys, matching how ApiKey.organizationId (not userId alone) is now scoped.
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getSessionOrgContext(request);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ apiKeys: apiKeys.map(serializeApiKey) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await getSessionOrgContext(request);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, ctx.role, { apiKey: ["manage"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { name?: string };

  const keyCount = await prisma.apiKey.count({ where: { organizationId: ctx.organizationId } });
  const keyName = body.name?.trim() || `API Key ${keyCount + 1}`;

  const rawKey = `pk_live_${randomToken(32)}`;
  const hashedKey = sha256(rawKey);
  const maskedKey = maskApiKey(rawKey);

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      name: keyName,
      hashedKey,
      maskedKey,
      useAi: false,
      aiProvider: "openai",
      aiTier: "AUTO",
      isActive: true,
    },
  });

  return NextResponse.json({
    apiKey: serializeApiKey(apiKey),
    rawKey,
  });
}
