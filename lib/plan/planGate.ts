// What a plan limit looks like on the wire, and how the dashboard picks it up. Pure and
// browser-safe: the API side builds the body with planGateBody() (see planGateResponse.ts),
// the dashboard reads it back with parsePlanGate() and turns it into the one consistent
// "here's what you need, upgrade here" prompt (app/dashboard/_components/UpgradePrompt.tsx).
// The same code works for an AI assistant reading the MCP/API error.

import { PLAN, isPaidPlanId, type PaidPlanId } from "./plans";

/** Every limit the Free/Starter/Pro tiers put on a feature. Stable: clients switch on these. */
export const PLAN_GATE_CODES = [
  "PLAN_PAGE_LIMIT_EXCEEDED",
  "PLAN_SITE_LIMIT_EXCEEDED",
  "PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE",
  "PLAN_CUSTOM_DOMAIN_LIMIT",
  "PLAN_PRODUCT_LIMIT",
  "PLAN_COMMERCE_LIMIT",
  "PLAN_ANALYTICS",
  "PLAN_CUSTOM_CODE",
  "PLAN_BRANDING",
  "PLAN_SERVER_APPS",
  "PLAN_AI_ACCESS",
  "PLAN_SITE_IMPORT",
  "PLAN_MIGRATION",
  "PLAN_BLOG_LIMIT",
  "PLAN_SEAT_LIMIT_EXCEEDED",
  "PLAN_PROJECT_LIMIT",
  "PLAN_HOSTING_TIER",
  /** More sites, landing pages or email templates than the plan holds. */
  "PLAN_TEMPLATE_LIMIT",
  /** Every funnel / course (members area) slot the plan includes is in use. */
  "PLAN_FUNNEL_SLOTS",
  /** Using the store's own Paystack / Stripe account (Pro and above). */
  "PLAN_OWN_PAYMENT_KEYS",
  /** Host-managed AI access for apps built on Plexo (Pro and above). */
  "PLAN_HOST_MANAGED_AI",
  /** More API keys than the plan holds. */
  "PLAN_API_KEYS",
] as const;
export type PlanGateCode = (typeof PLAN_GATE_CODES)[number];

/** The plan a limit is lifted by when the server doesn't say (it normally does, via requiredPlan). */
const DEFAULT_REQUIRED: Partial<Record<PlanGateCode, PaidPlanId>> = {
  PLAN_SERVER_APPS: PLAN.PRO,
  PLAN_AI_ACCESS: PLAN.PRO,
  PLAN_SITE_LIMIT_EXCEEDED: PLAN.PRO,
  PLAN_OWN_PAYMENT_KEYS: PLAN.PRO,
  PLAN_HOST_MANAGED_AI: PLAN.PRO,
};

export type PlanGate = { code: string; message: string; requiredPlan: PaidPlanId; /** Funnel slots: one extra slot can be bought without changing plan. */ canBuySlot?: boolean };

export function planGateBody(code: PlanGateCode, message: string, requiredPlan: PaidPlanId = DEFAULT_REQUIRED[code] ?? PLAN.STARTER, details: Record<string, unknown> = {}) {
  return { error: message, code, requiredPlan, upgradeUrl: "/dashboard/settings/subscription", ...details };
}

/** Reads an API error body. Returns the gate when the failure is a plan limit, otherwise null (it's an ordinary error). */
export function parsePlanGate(payload: unknown): PlanGate | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { error?: unknown; code?: unknown; requiredPlan?: unknown; requiresUpgrade?: unknown; state?: unknown; canBuySlot?: unknown };
  const message = typeof p.error === "string" ? p.error : "";
  const known = typeof p.code === "string" && (PLAN_GATE_CODES as readonly string[]).includes(p.code);
  // Older routes flag a plan limit without a code (requiresUpgrade / state: "upgrade").
  const legacy = p.requiresUpgrade === true || p.state === "upgrade";
  if (!known && !legacy) return null;
  const code = known ? (p.code as string) : "PLAN_REQUIRED";
  const fallback = DEFAULT_REQUIRED[code as PlanGateCode] ?? PLAN.STARTER;
  return { code, message: message || "This is part of a bigger plan.", requiredPlan: isPaidPlanId(p.requiredPlan) ? p.requiredPlan : fallback, ...(p.canBuySlot === true ? { canBuySlot: true } : {}) };
}

/** Where a plan page checkout sends the owner: it starts payment for `plan`, then comes back to `returnTo`. */
export function upgradeHref(plan: PaidPlanId, returnTo: string): string {
  return `/dashboard/settings/subscription?upgrade=${plan}&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/** Only same-site paths may be returned to (this ends up in a payment redirect). */
export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("://") ? value : fallback;
}

// ── A publish that was waiting on an upgrade ─────────────────────────────────────────────
// Paying (or starting the trial) leaves the editor. This is what the editor stores first so
// that, on the way back, it picks up exactly where the owner was and finishes publishing.

export type PendingPublish = {
  kind: "publish";
  templateId: string;
  domainType: "SUBDOMAIN" | "CUSTOM";
  domain: string;
  /** Put the site live in place of the one that is live now (the Free plan's one-site rule). */
  replaceLive?: boolean;
  savedAt: number;
};

export const PENDING_PUBLISH_MAX_AGE_MS = 60 * 60 * 1000;
export const pendingPublishKey = (templateId: string) => `plexo-pending-publish-${templateId}`;

export function serializePendingPublish(p: Omit<PendingPublish, "savedAt" | "kind">, now = Date.now()): string {
  return JSON.stringify({ ...p, kind: "publish", savedAt: now } satisfies PendingPublish);
}

/** The stored pending publish if it is well-formed, for this site and recent enough; otherwise null. */
export function readPendingPublish(raw: string | null | undefined, templateId: string, now = Date.now()): PendingPublish | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingPublish>;
    if (v.kind !== "publish" || v.templateId !== templateId) return null;
    if (v.domainType !== "SUBDOMAIN" && v.domainType !== "CUSTOM") return null;
    if (typeof v.domain !== "string" || !v.domain.trim()) return null;
    if (typeof v.savedAt !== "number" || now - v.savedAt > PENDING_PUBLISH_MAX_AGE_MS || v.savedAt > now + 60_000) return null;
    return { kind: "publish", templateId, domainType: v.domainType, domain: v.domain, replaceLive: v.replaceLive === true, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

/** The page to come back to after paying; `?resume=publish` tells the editor to finish the pending publish. */
export function publishReturnPath(templateId: string): string {
  return `/dashboard/templates/${templateId}?resume=publish`;
}

// ── Remembering a limit by its message ───────────────────────────────────────────────────
// Screens keep their errors as plain text. When a request fails on a plan limit the request
// helpers note the gate here, so the screen's error spot can show the upgrade prompt for
// exactly that text instead of the bare words (see GateOrError in UpgradePrompt.tsx).

const seenGates = new Map<string, PlanGate>();

/** Notes a failed response's plan limit, if it is one. Returns it so callers can branch too. */
export function rememberPlanGate(payload: unknown): PlanGate | null {
  const gate = parsePlanGate(payload);
  if (gate) {
    if (seenGates.size > 50) seenGates.clear();
    seenGates.set(gate.message, gate);
  }
  return gate;
}

export function planGateForMessage(message: string | null | undefined): PlanGate | null {
  return message ? (seenGates.get(message) ?? null) : null;
}

// ── Which limits the screen is already explaining ────────────────────────────────────────
// An UpgradePrompt registers its message while it is on screen. The dashboard's safety net
// (PlanGateWatcher) only opens its own prompt for a limit nothing on the page is showing,
// so every plan limit is explained exactly once and none ends as a bare error.

const shownGates = new Map<string, number>();

export function markGateShown(message: string): () => void {
  shownGates.set(message, (shownGates.get(message) ?? 0) + 1);
  return () => {
    const n = (shownGates.get(message) ?? 1) - 1;
    if (n <= 0) shownGates.delete(message);
    else shownGates.set(message, n);
  };
}

export function isGateShown(message: string): boolean {
  return shownGates.has(message);
}

/** Whether a failed request is one the safety net may explain by itself: an action (not a page load) that hit a plan limit. */
export function isActionGateFailure(method: string | undefined, status: number): boolean {
  return (status === 402 || status === 403) && (method ?? "GET").toUpperCase() !== "GET";
}
