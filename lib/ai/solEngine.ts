import { decryptSecret } from "@/lib/crypto";
import { resolveSystemProvider } from "@/lib/ai/systemProvider";
import { resolveActiveApiKeyForUser } from "@/lib/ai/resolveUserAiKey";
import type { AiActionMode, AiProvider, ConcreteTier, GenerateOutcome } from "@/lib/ai/types";
import { chargeUsage, ensureCreditPeriod, estimateWorstCaseCost } from "@/lib/db/ledgerOperations";
import { User } from "@/lib/db/coreEntities";

// SOL is Plexo's one AI. Every AI feature — SOL chat, the site editor's AI edits, the blog
// writer, the new-site wizard, product import — runs through these rules, so the same request
// gets the same model and is paid for the same way wherever it's made:
//
//   1. Which AI: the account's choice in Settings → AI. "Plexo's AI" runs on Plexo's system
//      provider (SYSTEM_AI_PROVIDER — Claude on Bedrock) and is paid from AI credits; "Your own
//      key" runs on that key and is billed by the provider, never in credits. Keys saved before
//      that choice existed (no mode recorded) count as "your own key", as they always have.
//      (Host-managed SDK access is the builder's own, separate flow — lib/ai/generateRequest.ts.)
//   2. Which tier: what was asked for, except that Free accounts on Plexo's AI always use Basic
//      — their monthly allowance is small (lib/credits/value.ts) and Basic goes ~3× further.
//   3. Paying: before running, the account must cover the worst case of the next call; after,
//      what was actually used is charged (lib/db/ledgerOperations.ts).

export const SOL_UNAVAILABLE = "Plexo's AI isn't available right now. Add your own AI provider key in Settings → AI to keep going, or try again later.";
export const SOL_NOT_ENOUGH_CREDITS = "You don't have enough AI credits for this. Top up in Settings → Subscription, or add your own AI provider key in Settings → AI.";
const KEY_UNREADABLE = "Your saved AI key couldn't be read. Please enter it again in Settings → AI.";

export type SolRoute = { provider: AiProvider; apiKey: string; paidBy: "plexo" | "own-key" };
export type SolRefusal = { error: string; status: number };

/** The AI settings on an account's API key that decide who runs its requests. */
export type AiKeySettings = { aiAccessMode?: string | null; aiApiKey?: string | null; aiProvider?: string | null };

/** Rule 1 — which AI runs a request for the account behind this API key (or none). */
export function routeForKey(key: AiKeySettings | null): SolRoute | SolRefusal {
  const mode = key?.aiAccessMode;
  const ownKey = !!key?.aiApiKey && (mode === "BYOK" || mode === undefined || mode === null);
  if (ownKey) {
    try {
      return { provider: key!.aiProvider as AiProvider, apiKey: decryptSecret(key!.aiApiKey!), paidBy: "own-key" };
    } catch {
      return { error: KEY_UNREADABLE, status: 500 };
    }
  }
  try {
    const system = resolveSystemProvider();
    return { provider: system.provider, apiKey: system.apiKey, paidBy: "plexo" };
  } catch (err) {
    console.error("[sol] Plexo's own AI isn't set up on this deployment:", err instanceof Error ? err.message : err);
    return { error: SOL_UNAVAILABLE, status: 503 };
  }
}

/** Rule 1 for a signed-in person, plus their plan (for rule 2). */
export async function solRouteForUser(userId: string): Promise<{ route: SolRoute; plan: string } | SolRefusal> {
  const [key, user] = await Promise.all([resolveActiveApiKeyForUser(userId), User.get({ id: userId }).go().then((r) => r.data)]);
  const route = routeForKey(key);
  if ("error" in route) return route;
  return { route, plan: user?.subscriptionPlan ?? "FREE" };
}

/** Rule 2 — the tier a request actually runs on. */
export function tierFor(route: SolRoute, plan: string, requested: ConcreteTier): ConcreteTier {
  return route.paidBy === "plexo" && plan === "FREE" ? "BASIC" : requested;
}

/** Rule 3, before — null if the account can cover the worst case of one call, else why not. */
export async function checkCanAfford(userId: string, route: SolRoute, tier: ConcreteTier, mode: AiActionMode, approxInputChars: number): Promise<SolRefusal | null> {
  if (route.paidBy !== "plexo") return null;
  const balance = await ensureCreditPeriod(userId);
  return balance.total < estimateWorstCaseCost(route.provider, tier, mode, approxInputChars) ? { error: SOL_NOT_ENOUGH_CREDITS, status: 402 } : null;
}

/** Rule 3, after — charge what was actually used (Plexo's AI only). */
export async function chargeFor(userId: string, route: SolRoute, tier: ConcreteTier, mode: AiActionMode, usage: GenerateOutcome["usage"]): Promise<void> {
  if (route.paidBy !== "plexo") return;
  await chargeUsage(userId, { provider: route.provider, tier, mode, usage });
}

export const BASIC_LOCK_NOTE = "On the Free plan, SOL uses the Basic model so your monthly AI goes further. Upgrade to choose Medium or High.";

/** For the chat box: the tier this person is held to (rule 2), with the reason — or null when
 *  they choose freely (paid plans, or Free accounts using their own key). */
export async function lockedTierFor(userId: string): Promise<{ tier: "BASIC"; note: string } | null> {
  const resolved = await solRouteForUser(userId);
  if ("error" in resolved) return null;
  return tierFor(resolved.route, resolved.plan, "HIGH") === "BASIC" ? { tier: "BASIC", note: BASIC_LOCK_NOTE } : null;
}
