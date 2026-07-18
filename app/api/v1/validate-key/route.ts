import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * GET /api/v1/validate-key
 *
 * Validates the supplied API key or dashboard session ('workspace-internal')
 * and returns the authenticated user's subscription plan and active limits.
 *
 * Headers:
 *   x-api-key: <raw api key> | "workspace-internal"
 *
 * Responses:
 *   200 { valid: true, plan: "FREE" | "PRO" | "ULTRA", useAi: boolean, aiProvider: string, aiTier: string }
 *   400 { valid: false, error: "API key is required." }
 *   401 { valid: false, error: "Invalid key or unauthorized." }
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
    let subscriptionPlan = "ULTRA";
    let useAi = false;
    let aiProvider = "openai";
    let aiTier = "AUTO";

    if (rawKey === "workspace-internal") {
      const { auth } = await import("@/server/auth");
      const session = await auth.api.getSession({ headers: request.headers });

      if (!session?.user) {
        return NextResponse.json(
          { valid: false, error: "Unauthorized: No active session found." },
          { status: 401 }
        );
      }

      const user = await (prisma.user.findUnique as any)({
        where: { id: session.user.id },
        select: {
          subscriptionPlan: true,
          apiKeys: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { useAi: true, aiProvider: true, aiTier: true },
          },
        },
      });

      if (!user) {
        return NextResponse.json(
          { valid: false, error: "Authenticated user not found." },
          { status: 401 }
        );
      }

      subscriptionPlan = user.subscriptionPlan ?? "ULTRA";
      if (user.apiKeys?.[0]) {
        useAi = user.apiKeys[0].useAi;
        aiProvider = user.apiKeys[0].aiProvider;
        aiTier = user.apiKeys[0].aiTier;
      }
    } else {
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
          aiProvider: true,
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
      const user = await (prisma.user.findUnique as any)({
        where: { id: apiKey.userId },
        select: { subscriptionPlan: true },
      });

      subscriptionPlan = user?.subscriptionPlan ?? "ULTRA";
      useAi = apiKey.useAi;
      aiProvider = apiKey.aiProvider;
      aiTier = apiKey.aiTier;

      // Touch lastUsedAt so we can track active SDK sessions
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    }

    return NextResponse.json({
      valid: true,
      plan: subscriptionPlan,
      useAi,
      aiProvider,
      aiTier,
    });
  } catch (err) {
    console.error("[validate-key] Unexpected error:", err);
    return NextResponse.json(
      { valid: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
