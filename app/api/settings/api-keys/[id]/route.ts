import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";

const PROVIDER_VALUES = new Set(["openai", "anthropic_claude", "google_gemini"]);
const TIER_VALUES = new Set<AiTier>(["AUTO", "BASIC", "MEDIUM", "HIGH"]);

function serializeApiKey(record: {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: Date;
  isActive: boolean;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
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
  };
}

async function getSessionUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: "revoke";
    useAi?: boolean;
    aiProvider?: string;
    aiTier?: AiTier;
  };

  const existingKey = await prisma.apiKey.findFirst({
    where: {
      id: params.id,
      userId: user.id,
    },
  });

  if (!existingKey) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  if ("action" in body && body.action === "revoke") {
    const revoked = await prisma.apiKey.update({
      where: { id: existingKey.id },
      data: { isActive: false },
    });

    return NextResponse.json({ apiKey: serializeApiKey(revoked) });
  }

  const useAi = typeof body.useAi === "boolean" ? body.useAi : existingKey.useAi;
  const aiProvider = typeof body.aiProvider === "string" ? body.aiProvider : existingKey.aiProvider;
  const aiTier = typeof body.aiTier === "string" ? body.aiTier : existingKey.aiTier;

  if (!PROVIDER_VALUES.has(aiProvider)) {
    return NextResponse.json({ error: "Invalid AI provider" }, { status: 400 });
  }

  if (!TIER_VALUES.has(aiTier)) {
    return NextResponse.json({ error: "Invalid AI tier" }, { status: 400 });
  }

  const updated = await prisma.apiKey.update({
    where: { id: existingKey.id },
    data: {
      useAi,
      aiProvider,
      aiTier,
    },
  });

  return NextResponse.json({ apiKey: serializeApiKey(updated) });
}
