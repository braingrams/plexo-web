import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { classifyPromptComplexity } from "@/lib/ai/complexity";
import { decryptSecret } from "@/lib/crypto";
import { generateBuilderAction } from "@/lib/ai/generate";
import { resolveSystemProvider } from "@/lib/ai/systemProvider";
import type { AiActionMode, AiProvider, ConcreteTier } from "@/lib/ai/types";
import { chargeUsage, ensureCreditPeriod, estimateWorstCaseCost } from "@/lib/credits/ledger";
import { prisma } from "@/server/prisma";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  const trimmed = token.trim();
  return trimmed ? trimmed : null;
}

const VALID_MODES = new Set<AiActionMode>(["edit_element", "edit_layout", "generate_layout"]);
const VALID_TIERS = new Set(["AUTO", "BASIC", "MEDIUM", "HIGH"]);

interface ResolvedAiKey {
  id: string;
  userId: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: string;
  aiApiKey: string | null;
}

type ResolveResult = { key: ResolvedAiKey } | { error: string; status: number };

async function resolveAiKey(request: NextRequest): Promise<ResolveResult> {
  const xApiKey = request.headers.get("x-api-key")?.trim();

  if (xApiKey === "workspace-internal") {
    const { auth } = await import("@/server/auth");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return { error: "Unauthorized", status: 401 };
    }

    const activeKey = await prisma.apiKey.findFirst({
      where: { userId: session.user.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, useAi: true, aiProvider: true, aiTier: true, aiApiKey: true },
    });

    if (!activeKey) {
      return { error: "No active API key configured for this account.", status: 400 };
    }

    return { key: activeKey };
  }

  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    return { error: "Unauthorized", status: 401 };
  }

  const hashedKey = sha256(bearerToken);
  const activeKey = await prisma.apiKey.findFirst({
    where: { hashedKey, isActive: true },
    select: { id: true, userId: true, useAi: true, aiProvider: true, aiTier: true, aiApiKey: true },
  });

  if (!activeKey) {
    return { error: "Forbidden", status: 403 };
  }

  return { key: activeKey };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveAiKey(request);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { key } = resolved;

  if (!key.useAi) {
    return NextResponse.json({ error: "AI is not enabled for this account." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    mode?: string;
    prompt?: string;
    templateKind?: string;
    context?: unknown;
    tier?: string;
  } | null;

  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  }
  if (!body.mode || !VALID_MODES.has(body.mode as AiActionMode)) {
    return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
  }
  if (body.templateKind !== "EMAIL" && body.templateKind !== "LANDING_PAGE") {
    return NextResponse.json({ error: "Invalid templateKind." }, { status: 400 });
  }
  if (body.context === undefined || body.context === null) {
    return NextResponse.json({ error: "Context is required." }, { status: 400 });
  }

  const mode = body.mode as AiActionMode;
  const tier = body.tier && VALID_TIERS.has(body.tier) ? body.tier : key.aiTier;

  let provider: AiProvider;
  let providerApiKey: string;
  let isSystemAi = false;

  if (key.aiApiKey) {
    // BYOK — unchanged from Phase 1, no credits touched, the account's own key/bill.
    provider = key.aiProvider as AiProvider;
    try {
      providerApiKey = decryptSecret(key.aiApiKey);
    } catch {
      return NextResponse.json(
        { error: "Stored AI key could not be decrypted. Please re-enter it in Settings." },
        { status: 500 },
      );
    }
  } else {
    // System AI — paid for out of the account's credit balance.
    isSystemAi = true;
    let systemProvider;
    try {
      systemProvider = resolveSystemProvider();
    } catch (err) {
      return NextResponse.json(
        { error: `System AI is not configured: ${err instanceof Error ? err.message : "unknown error"}` },
        { status: 503 },
      );
    }
    provider = systemProvider.provider;
    providerApiKey = systemProvider.apiKey;

    const concreteTier: ConcreteTier = tier === "AUTO" ? classifyPromptComplexity(mode, body.prompt) : (tier as ConcreteTier);
    const balance = await ensureCreditPeriod(key.userId);
    const approxInputChars = body.prompt.length + JSON.stringify(body.context).length;
    const estimatedCost = estimateWorstCaseCost(provider, concreteTier, mode, approxInputChars);

    if (balance.total < estimatedCost) {
      return NextResponse.json(
        { error: "Insufficient credits — top up or configure your own API key in Settings." },
        { status: 402 },
      );
    }
  }

  try {
    const outcome = await generateBuilderAction({
      provider,
      tier,
      apiKey: providerApiKey,
      mode,
      prompt: body.prompt,
      templateKind: body.templateKind,
      context: body.context,
    });

    if (isSystemAi) {
      const concreteTier: ConcreteTier = tier === "AUTO" ? classifyPromptComplexity(mode, body.prompt) : (tier as ConcreteTier);
      await chargeUsage(key.userId, { provider, tier: concreteTier, mode, usage: outcome.usage });
    }

    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

    // Usage/cost accounting is server-internal — the browser only ever gets summary + result.
    return NextResponse.json({ summary: outcome.summary, result: outcome.result });
  } catch (err) {
    return NextResponse.json(
      { error: `AI generation failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 502 },
    );
  }
}
