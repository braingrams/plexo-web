import { effectivePlan } from "@/lib/plan/entitlement";
import { createHash } from "node:crypto";

import { classifyPromptComplexity } from "@/lib/ai/complexity";
import { decryptSecret } from "@/lib/crypto";
import { GenerationStoppedError, generateBuilderAction } from "@/lib/ai/generate";
import { authorizeHostManagedAction, newRequestId, settleHostManagedAction } from "@/lib/ai/hostAuthorization";
import { SOL_NOT_ENOUGH_CREDITS, SOL_UNAVAILABLE, checkCanAfford, routeForKey, tierFor } from "@/lib/ai/solEngine";
import type { AiActionMode, AiProvider, ConcreteTier } from "@/lib/ai/types";
import { chargeUsage, ensureCreditPeriod, estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import { resolveActiveApiKeyForUser } from "@/lib/ai/resolveUserAiKey";
import { canUseHostManagedAi } from "@/lib/subscription";
import { ApiKey, User } from "@/lib/db/coreEntities";

// One AI builder request, start to finish — who's asking, whether they may, whether they
// can afford it, the generation itself, and paying for it. Shared by the buffered route
// (app/api/v1/ai/generate) and the streaming one (lambda/sol-chat → /api/v1/ai/stream/generate),
// so both behave identically; the streaming one also reports progress as the page is written.
// Which AI runs, on which tier, and how it's paid for follow SOL's rules (lib/ai/solEngine.ts),
// the same as every other AI feature; only host-managed SDK access is handled here.

const VALID_MODES = new Set<AiActionMode>(["edit_element", "edit_layout", "generate_layout", "edit_raw_html", "generate_raw_html", "generate_blog_post"]);
const VALID_TIERS = new Set(["AUTO", "BASIC", "MEDIUM", "HIGH"]);

export const NOT_ENOUGH_CREDITS = SOL_NOT_ENOUGH_CREDITS;

export interface ResolvedAiKey {
  id: string;
  userId: string;
  organizationId: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: string;
  aiApiKey: string | null;
  /** null: saved before the access-mode choice existed (treated as "own key" if one is saved). */
  aiAccessMode: "SYSTEM" | "BYOK" | "HOST_MANAGED" | null;
  hostAuthWebhookUrl: string | null;
  hostWebhookSecret: string | null;
  subscriptionPlan: string;
}

export const PLEXO_AI_UNAVAILABLE = SOL_UNAVAILABLE;
const BAD_API_KEY = "That API key isn't valid or has been turned off. Check it in Settings → API keys.";

export type Refusal = { status: number; error: string };
type ApiKeyItem = Awaited<ReturnType<typeof resolveActiveApiKeyForUser>>;

function toResolvedAiKey(item: NonNullable<ApiKeyItem>, subscriptionPlan: string): ResolvedAiKey {
  return {
    id: item.id,
    userId: item.userId,
    organizationId: item.organizationId,
    useAi: item.useAi ?? false,
    aiProvider: item.aiProvider ?? "openai",
    aiTier: item.aiTier ?? "AUTO",
    aiApiKey: item.aiApiKey ?? null,
    aiAccessMode: item.aiAccessMode ?? null,
    hostAuthWebhookUrl: item.hostAuthWebhookUrl ?? null,
    hostWebhookSecret: item.hostWebhookSecret ?? null,
    subscriptionPlan,
  };
}

/** A signed-in dashboard user: their account's active API key carries the AI settings. */
export async function resolveAiKeyForUser(userId: string): Promise<{ key: ResolvedAiKey } | Refusal> {
  const activeKey = await resolveActiveApiKeyForUser(userId);
  if (!activeKey) return { error: "No active API key configured for this account.", status: 400 };
  const { data: user } = await User.get({ id: activeKey.userId }).go();
  if (!user) return { error: "No active API key configured for this account.", status: 400 };
  return { key: toResolvedAiKey(activeKey, effectivePlan(user)) };
}

/** An API caller (SDK, integrations) presenting a raw key. */
export async function resolveAiKeyByRawKey(rawKey: string): Promise<{ key: ResolvedAiKey } | Refusal> {
  const hashedKey = createHash("sha256").update(rawKey, "utf8").digest("hex");
  const { data: matches } = await ApiKey.query.byHashedKey({ hashedKey }).go({ pages: "all" });
  const activeKey = matches.find((k) => k.isActive);
  if (!activeKey) return { error: BAD_API_KEY, status: 403 };
  const { data: user } = await User.get({ id: activeKey.userId }).go();
  if (!user) return { error: BAD_API_KEY, status: 403 };
  return { key: toResolvedAiKey(activeKey as NonNullable<ApiKeyItem>, effectivePlan(user)) };
}

export interface GenerateInput {
  mode: AiActionMode;
  prompt: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  context: unknown;
  tier: string;
  concreteTier: ConcreteTier;
  externalUserId?: string;
  isBlogLayout: boolean;
}

/** The request body, checked — or why it can't be run. */
export function parseGenerateBody(key: ResolvedAiKey, raw: unknown): { input: GenerateInput } | Refusal {
  if (!key.useAi) return { error: "AI is not enabled for this account.", status: 403 };
  const body = raw as {
    mode?: string;
    prompt?: string;
    templateKind?: string;
    context?: unknown;
    tier?: string;
    externalUserId?: string;
    isBlogLayout?: boolean;
  } | null;
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) return { error: "A prompt is required.", status: 400 };
  if (!body.mode || !VALID_MODES.has(body.mode as AiActionMode)) return { error: "Invalid mode.", status: 400 };
  if (body.templateKind !== "EMAIL" && body.templateKind !== "LANDING_PAGE") return { error: "Invalid templateKind.", status: 400 };
  // Every mode edits or extends something that already exists — except generate_raw_html,
  // which writes a brand-new page from the prompt alone, so there's nothing to send as context.
  if ((body.context === undefined || body.context === null) && body.mode !== "generate_raw_html") return { error: "Context is required.", status: 400 };
  if (key.aiAccessMode === "HOST_MANAGED" && (!body.externalUserId || !body.externalUserId.trim())) {
    return { error: "externalUserId is required for this account's AI access mode.", status: 400 };
  }
  const mode = body.mode as AiActionMode;
  const tier = body.tier && VALID_TIERS.has(body.tier) ? body.tier : key.aiTier;
  const concreteTier: ConcreteTier = tier === "AUTO" ? classifyPromptComplexity(mode, body.prompt) : (tier as ConcreteTier);
  return {
    input: {
      mode,
      prompt: body.prompt,
      templateKind: body.templateKind,
      context: body.context,
      tier,
      concreteTier,
      externalUserId: body.externalUserId?.trim(),
      isBlogLayout: body.isBlogLayout === true,
    },
  };
}

export interface GenerationPlan {
  provider: AiProvider;
  providerApiKey: string;
  isSystemAi: boolean;
  isHostManaged: boolean;
  hostRequestId: string | null;
}

function approxInputChars(input: GenerateInput): number {
  return input.prompt.length + JSON.stringify(input.context ?? null).length;
}

/**
 * Which AI runs this and on whose account — and, for Plexo's own AI, that the account can
 * afford it BEFORE anything runs (worst case: the whole output budget). A person using their
 * own provider key pays their provider; a host-managed app authorizes through its webhook.
 */
export async function planGeneration(key: ResolvedAiKey, input: GenerateInput): Promise<{ plan: GenerationPlan } | Refusal> {
  if (key.aiAccessMode === "HOST_MANAGED") {
    // Host-Managed — the embedding host app authorizes/settles its own end users via webhook
    // AND supplies its own AI provider key. No fallback to System AI, by design.
    if (!canUseHostManagedAi(key.subscriptionPlan)) return { error: "Host-Managed AI access requires the Ultra plan on this Plexo account.", status: 403 };
    if (!key.hostAuthWebhookUrl || !key.hostWebhookSecret) {
      return { error: "Host-Managed AI access is not fully configured for this account (missing webhook URL/secret).", status: 503 };
    }
    if (!key.aiApiKey) {
      return { error: "Host-Managed AI access requires the account's own AI provider key. Add one in Settings — Plexo's system key is not used in this mode.", status: 503 };
    }
    let providerApiKey: string;
    try {
      providerApiKey = decryptSecret(key.aiApiKey);
    } catch {
      return { error: "Stored AI key could not be decrypted. Please re-enter it in Settings.", status: 500 };
    }
    const hostRequestId = newRequestId();
    const authorization = await authorizeHostManagedAction(
      { hostAuthWebhookUrl: key.hostAuthWebhookUrl, hostWebhookSecret: decryptSecret(key.hostWebhookSecret) },
      { externalUserId: input.externalUserId!, actionMode: input.mode, tier: input.concreteTier, requestId: hostRequestId },
    );
    if (!authorization.allowed) return { error: authorization.reason ?? "AI access denied by the host application.", status: 402 };
    return { plan: { provider: key.aiProvider as AiProvider, providerApiKey, isSystemAi: false, isHostManaged: true, hostRequestId } };
  }

  // Everything else follows SOL's rules: the account's Settings → AI choice decides whose AI
  // runs; Free accounts on Plexo's AI run on Basic; Plexo's AI must be affordable up front.
  const route = routeForKey(key);
  if ("error" in route) return route;
  input.concreteTier = tierFor(route, key.subscriptionPlan, input.concreteTier);
  const plan: GenerationPlan = { provider: route.provider, providerApiKey: route.apiKey, isSystemAi: route.paidBy === "plexo", isHostManaged: false, hostRequestId: null };
  const refusal = await checkCanAfford(key.userId, route, input.concreteTier, input.mode, approxInputChars(input));
  return refusal ?? { plan };
}

/** What this request would cost at most, and whether the account can cover it — for showing before anyone clicks. */
export async function creditCheck(key: ResolvedAiKey, input: GenerateInput): Promise<{ paidBy: "plexo" | "own-key" | "host"; enough: boolean; estimatedCredits: number | null; balance: number | null; message?: string }> {
  if (key.aiAccessMode === "HOST_MANAGED") return { paidBy: "host", enough: true, estimatedCredits: null, balance: null };
  const route = routeForKey(key);
  if ("error" in route) return { paidBy: "plexo", enough: false, estimatedCredits: null, balance: null, message: route.error };
  if (route.paidBy === "own-key") return { paidBy: "own-key", enough: true, estimatedCredits: null, balance: null };
  const tier = tierFor(route, key.subscriptionPlan, input.concreteTier);
  const balance = await ensureCreditPeriod(key.userId);
  const estimatedCredits = estimateWorstCaseCost(route.provider, tier, input.mode, approxInputChars(input));
  const enough = balance.available >= estimatedCredits;
  return { paidBy: "plexo", enough, estimatedCredits, balance: balance.total, ...(enough ? {} : { message: NOT_ENOUGH_CREDITS }) };
}

/**
 * Runs the generation and settles it. Before every call to the AI — including the bigger
 * retry when an answer comes back cut off — Plexo's own AI re-checks the account can still
 * afford that call; what was actually used (all calls) is charged afterwards.
 */
export async function runGeneration(
  key: ResolvedAiKey,
  input: GenerateInput,
  plan: GenerationPlan,
  onProgress?: (progress: { characters: number; attempt: number }) => void,
): Promise<{ summary: string; result: unknown }> {
  const outcome = await generateBuilderAction({
    provider: plan.provider,
    // The tier decided in planGeneration (incl. Free → Basic), not "AUTO" re-picked here.
    tier: input.concreteTier,
    apiKey: plan.providerApiKey,
    mode: input.mode,
    prompt: input.prompt,
    templateKind: input.templateKind,
    isBlogLayout: input.isBlogLayout,
    context: input.context,
    onProgress,
    beforeAttempt: plan.isSystemAi
      ? async (maxTokens, attempt) => {
          if (attempt === 1) return; // checked in planGeneration, just before this
          const balance = await ensureCreditPeriod(key.userId);
          if (balance.available < estimateWorstCaseCost(plan.provider, input.concreteTier, input.mode, approxInputChars(input), maxTokens)) {
            throw new GenerationStoppedError(
              "Your page needed a longer answer than your remaining AI credits cover. Top up in Settings → Subscription, or try a shorter description.",
            );
          }
        }
      : undefined,
  });

  if (plan.isSystemAi) {
    await chargeUsage(key.userId, { provider: plan.provider, tier: input.concreteTier, mode: input.mode, usage: outcome.usage });
  } else if (plan.isHostManaged) {
    await settleHostManagedAction(
      { hostAuthWebhookUrl: key.hostAuthWebhookUrl!, hostWebhookSecret: decryptSecret(key.hostWebhookSecret!) },
      { externalUserId: input.externalUserId!, actionMode: input.mode, tier: input.concreteTier, usage: outcome.usage, requestId: plan.hostRequestId! },
    );
  }
  await ApiKey.patch({ organizationId: key.organizationId, id: key.id }).set({ lastUsedAt: new Date().toISOString() }).go();
  // Usage/cost accounting is server-internal — the browser only ever gets summary + result.
  return { summary: outcome.summary, result: outcome.result };
}
