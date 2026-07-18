import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * GET /api/v1/validate-key
 *
 * Validates the supplied API key and returns the authenticated user's
 * subscription plan. Used by the Plexo Builder SDK on mount to determine
 * which features to gate.
 *
 * Headers:
 *   x-api-key: <raw api key>
 *
 * Responses:
 *   200 { valid: true,  plan: "FREE" | "PRO" | "ULTRA", useAi: boolean, aiModel: string, aiTier: string }
 *   400 { valid: false, error: "API key is required." }
 *   401 { valid: false, error: "Invalid or inactive API key." }
 *   500 { valid: false, error: "Internal server error." }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawKey = request.headers.get("x-api-key")?.trim();

  if (!rawKey) {
    return NextResponse.json(
      { valid: false, error: "API key is required." },
      { status: 400 }
    );
  }

  try {
    const hashedKey = sha256(rawKey);

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        hashedKey,
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        useAi: true,
        aiModel: true,
        aiTier: true,
      },
    });

    if (!apiKey) {
      return NextResponse.json(
        { valid: false, error: "Invalid or inactive API key." },
        { status: 401 }
      );
    }

    // Fetch the owner's subscription plan separately to avoid nested-select type issues
    const user = await prisma.user.findUnique({
      where: { id: apiKey.userId },
      select: { subscriptionPlan: true },
    });

    // Touch lastUsedAt so we can track active SDK sessions
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return NextResponse.json({
      valid: true,
      plan: user?.subscriptionPlan ?? "ULTRA",  // "FREE" | "PRO" | "ULTRA"
      useAi: apiKey.useAi,
      aiModel: apiKey.aiModel,
      aiTier: apiKey.aiTier,
    });
  } catch (err) {
    console.error("[validate-key] Unexpected error:", err);
    return NextResponse.json(
      { valid: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
