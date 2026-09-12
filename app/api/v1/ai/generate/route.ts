import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { classifyPromptComplexity } from "@/lib/ai/complexity";
import { decryptSecret } from "@/lib/crypto";
import { generateBuilderAction } from "@/lib/ai/generate";
import { authorizeHostManagedAction, newRequestId, settleHostManagedAction } from "@/lib/ai/hostAuthorization";
import { resolveSystemProvider } from "@/lib/ai/systemProvider";
import type { AiActionMode, AiProvider, ConcreteTier } from "@/lib/ai/types";
import { chargeUsage, ensureCreditPeriod, estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import { resolveActiveApiKeyForUser } from "@/lib/ai/resolveUserAiKey";
import { canUseHostManagedAi } from "@/lib/subscription";
import { auth } from "@/server/authDynamo";
import { ApiKey, User } from "@/lib/db/coreEntities";

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

const VALID_MODES = new Set<AiActionMode>([
  "edit_element",
  "edit_layout",
  "generate_layout",
  "edit_raw_html",
  "generate_raw_html",
  "generate_blog_post",
]);
const VALID_TIERS = new Set(["AUTO", "BASIC", "MEDIUM", "HIGH"]);

interface ResolvedAiKey {
  id: string;
  userId: string;
  organizationId: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: string;
  aiApiKey: string | null;
  aiAccessMode: "SYSTEM" | "BYOK" | "HOST_MANAGED";
  hostAuthWebhookUrl: string | null;
  hostWebhookSecret: string | null;
  subscriptionPlan: string;
}

type ResolveResult = { key: ResolvedAiKey } | { error: string; status: number };

function toResolvedAiKey(
  item: {
    id: string;
    userId: string;
    organizationId: string;
    useAi?: boolean;
    aiProvider?: string;
    aiTier?: string;
    aiApiKey?: string;
    aiAccessMode?: "SYSTEM" | "BYOK" | "HOST_MANAGED";
    hostAuthWebhookUrl?: string;
    hostWebhookSecret?: string;
  },
  subscriptionPlan: string,
): ResolvedAiKey {
  return {
    id: item.id,
    userId: item.userId,
    organizationId: item.organizationId,
    useAi: item.useAi ?? false,
    aiProvider: item.aiProvider ?? "openai",
    aiTier: item.aiTier ?? "AUTO",
    aiApiKey: item.aiApiKey ?? null,
    aiAccessMode: item.aiAccessMode ?? "SYSTEM",
    hostAuthWebhookUrl: item.hostAuthWebhookUrl ?? null,
    hostWebhookSecret: item.hostWebhookSecret ?? null,
    subscriptionPlan,
  };
}

async function resolveAiKey(request: NextRequest): Promise<ResolveResult> {
  const xApiKey = request.headers.get("x-api-key")?.trim();

  if (xApiKey === "workspace-internal") {
    const session = await auth();
    if (!session?.user) {
      return { error: "Unauthorized", status: 401 };
    }

    const activeKey = await resolveActiveApiKeyForUser(session.user.id);

    if (!activeKey) {
      return { error: "No active API key configured for this account.", status: 400 };
    }

    const { data: user } = await User.get({ id: activeKey.userId }).go();
    if (!user) {
      return { error: "No active API key configured for this account.", status: 400 };
    }

    return { key: toResolvedAiKey(activeKey, user.subscriptionPlan ?? "FREE") };
  }

  // @charisol/plexo-sdk sends the real key via x-api-key (see aiHelper.ts), never
  // Authorization — Bearer is only kept as a fallback for other callers, matching
  // the same x-api-key-first pattern already used by validate-key and domains.
  const rawKey = xApiKey || parseBearerToken(request.headers.get("authorization"));
  if (!rawKey) {
    return { error: "Unauthorized", status: 401 };
  }

  const hashedKey = sha256(rawKey);
  const { data: matches } = await ApiKey.query.byHashedKey({ hashedKey }).go();
  const activeKey = matches.find((k) => k.isActive);

  if (!activeKey) {
    return { error: "Forbidden", status: 403 };
  }

  const { data: user } = await User.get({ id: activeKey.userId }).go();
  if (!user) {
    return { error: "Forbidden", status: 403 };
  }

  return { key: toResolvedAiKey(activeKey, user.subscriptionPlan ?? "FREE") };
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
    externalUserId?: string;
    isBlogLayout?: boolean;
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
  if (key.aiAccessMode === "HOST_MANAGED" && (!body.externalUserId || !body.externalUserId.trim())) {
    return NextResponse.json(
      { error: "externalUserId is required for this account's AI access mode." },
      { status: 400 },
    );
  }

  const mode = body.mode as AiActionMode;
  const tier = body.tier && VALID_TIERS.has(body.tier) ? body.tier : key.aiTier;
  const concreteTier: ConcreteTier = tier === "AUTO" ? classifyPromptComplexity(mode, body.prompt) : (tier as ConcreteTier);

  let provider: AiProvider;
  let providerApiKey: string;
  let isSystemAi = false;
  let isHostManaged = false;
  let hostRequestId: string | null = null;

  if (key.aiAccessMode === "HOST_MANAGED") {
    // Host-Managed — the embedding host app is fully responsible for this
    // request: it authorizes/settles its own end users via webhook AND
    // supplies its own AI provider key. Plexo never touches its own credit
    // ledger and never supplies a provider key for this mode — there is no
    // fallback to System AI, by design (see hard requirement below).
    // Ultra-gated: this hands a host app control over every AI request Plexo
    // would otherwise meter/bill itself, so a plan downgrade must hard-block
    // it rather than silently falling back to (unmetered-for-the-host) System AI.
    if (!canUseHostManagedAi(key.subscriptionPlan)) {
      return NextResponse.json(
        { error: "Host-Managed AI access requires the Ultra plan on this Plexo account." },
        { status: 403 },
      );
    }
    isHostManaged = true;
    if (!key.hostAuthWebhookUrl || !key.hostWebhookSecret) {
      return NextResponse.json(
        { error: "Host-Managed AI access is not fully configured for this account (missing webhook URL/secret)." },
        { status: 503 },
      );
    }
    if (!key.aiApiKey) {
      return NextResponse.json(
        {
          error:
            "Host-Managed AI access requires the account's own AI provider key. Add one in Settings — Plexo's system key is not used in this mode.",
        },
        { status: 503 },
      );
    }

    provider = key.aiProvider as AiProvider;
    try {
      providerApiKey = decryptSecret(key.aiApiKey);
    } catch {
      return NextResponse.json(
        { error: "Stored AI key could not be decrypted. Please re-enter it in Settings." },
        { status: 500 },
      );
    }

    hostRequestId = newRequestId();
    const decryptedSecret = decryptSecret(key.hostWebhookSecret);
    const authorization = await authorizeHostManagedAction(
      { hostAuthWebhookUrl: key.hostAuthWebhookUrl, hostWebhookSecret: decryptedSecret },
      { externalUserId: body.externalUserId!.trim(), actionMode: mode, tier: concreteTier, requestId: hostRequestId },
    );

    if (!authorization.allowed) {
      return NextResponse.json(
        { error: authorization.reason ?? "AI access denied by the host application." },
        { status: 402 },
      );
    }
  } else if (key.aiApiKey) {
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
      isBlogLayout: body.isBlogLayout === true,
      context: body.context,
    });

    if (isSystemAi) {
      await chargeUsage(key.userId, { provider, tier: concreteTier, mode, usage: outcome.usage });
    } else if (isHostManaged) {
      const decryptedSecret = decryptSecret(key.hostWebhookSecret!);
      await settleHostManagedAction(
        { hostAuthWebhookUrl: key.hostAuthWebhookUrl!, hostWebhookSecret: decryptedSecret },
        {
          externalUserId: body.externalUserId!.trim(),
          actionMode: mode,
          tier: concreteTier,
          usage: outcome.usage,
          requestId: hostRequestId!,
        },
      );
    }

    await ApiKey.patch({ organizationId: key.organizationId, id: key.id })
      .set({ lastUsedAt: new Date().toISOString() })
      .go();

    // Usage/cost accounting is server-internal — the browser only ever gets summary + result.
    return NextResponse.json({ summary: outcome.summary, result: outcome.result });
  } catch (err) {
    return NextResponse.json(
      { error: `AI generation failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 502 },
    );
  }
}
