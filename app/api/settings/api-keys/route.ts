import { createHash, randomInt, randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { resolveOrgContext } from "@/app/api/org/_context";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { ApiKey } from "@/lib/db/coreEntities";
import type { EntityItem } from "electrodb";

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

export async function GET(): Promise<NextResponse> {
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const { data: apiKeys } = await ApiKey.query.primary({ organizationId: ctx.organizationId }).go();
  apiKeys.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return NextResponse.json({ apiKeys: apiKeys.map(serializeApiKey) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await resolveOrgContext();
  if (ctx.error) return ctx.error;

  const permissionError = requirePermission(ctx.role, { apiKey: ["manage"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { name?: string };

  const { data: existing } = await ApiKey.query.primary({ organizationId: ctx.organizationId }).go();
  const keyName = body.name?.trim() || `API Key ${existing.length + 1}`;

  const rawKey = `pk_live_${randomToken(32)}`;
  const hashedKey = sha256(rawKey);
  const maskedKey = maskApiKey(rawKey);

  const id = randomUUID();
  await ApiKey.create({
    id,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    name: keyName,
    hashedKey,
    maskedKey,
    useAi: false,
    aiProvider: "openai",
    aiTier: "AUTO",
    isActive: true,
  }).go();

  const { data: apiKey } = await ApiKey.get({ organizationId: ctx.organizationId, id }).go();
  if (!apiKey) throw new Error(`ApiKey ${id} vanished immediately after being created`);

  return NextResponse.json({
    apiKey: serializeApiKey(apiKey),
    rawKey,
  });
}
