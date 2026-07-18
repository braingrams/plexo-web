import { createHash, randomInt } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

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
  aiModel: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
}) {
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

async function getSessionUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ apiKeys: apiKeys.map(serializeApiKey) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string };

  const keyCount = await prisma.apiKey.count({ where: { userId: user.id } });
  const keyName = body.name?.trim() || `API Key ${keyCount + 1}`;

  const rawKey = `pk_live_${randomToken(32)}`;
  const hashedKey = sha256(rawKey);
  const maskedKey = maskApiKey(rawKey);

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: keyName,
      hashedKey,
      maskedKey,
      useAi: false,
      aiModel: "openai",
      aiTier: "AUTO",
      isActive: true,
    },
  });

  return NextResponse.json({
    apiKey: serializeApiKey(apiKey),
    rawKey,
  });
}
