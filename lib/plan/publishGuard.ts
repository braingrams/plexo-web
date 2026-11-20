import { PLAN } from "@/lib/plan/plans";
import { NextResponse } from "next/server";

import { getTierFeatures, isHomePageOnlyPlan } from "@/lib/subscription";
import { otherLiveSites } from "./siteLimits";
import { customDomainError } from "./domainGate";
import { PAID_PLAN_IDS, planLabel, toPlanId, type PaidPlanId } from "./plans";
import { planGateBody } from "./planGate";
import { planGateMessage } from "./limitGates";
import { listGovernedSites } from "./sitesStore";

// Server-side plan checks for every way something goes live. The serve route enforces the
// same limits for visitors regardless (app/pub/[domain]); these give the owner — or the AI
// assistant acting for them — a clear reason and a next step instead of a silent no-op.

export type PlanLimitCode = "PLAN_PAGE_LIMIT_EXCEEDED" | "PLAN_SITE_LIMIT_EXCEEDED" | "PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE" | "PLAN_CUSTOM_DOMAIN_LIMIT";

export class PlanLimitError extends Error {
  readonly status = 403;
  constructor(
    readonly code: PlanLimitCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function planLimitResponse(err: PlanLimitError): NextResponse {
  const { requiredPlan, ...details } = err.details as { requiredPlan?: PaidPlanId } & Record<string, unknown>;
  return NextResponse.json(planGateBody(err.code, err.message, requiredPlan ?? PLAN.STARTER, details), { status: err.status });
}

/**
 * Publishing a page. Free serves only a site's homepage, so publishing any other page is
 * refused — the page stays saved and goes live the moment the account upgrades.
 */
export function assertCanPublishPage(plan: string, page: { parentId?: string | null }): void {
  if (page.parentId && isHomePageOnlyPlan(plan)) {
    throw new PlanLimitError(
      "PLAN_PAGE_LIMIT_EXCEEDED",
      "The Free plan publishes one page per site — your homepage. This page is saved; upgrade to Starter to publish it.",
      { requiredPlan: PLAN.STARTER },
    );
  }
}

/**
 * Putting a site live at an address. Free: Plexo addresses only, and one live site at a
 * time. `templateId` is the site (root template) the address points at.
 */
export async function assertCanPutSiteLive(
  actor: { userId: string; subscriptionPlan: string; onTrial?: boolean },
  templateId: string,
  domainType: "SUBDOMAIN" | "CUSTOM",
): Promise<void> {
  const features = getTierFeatures(actor.subscriptionPlan, { trial: actor.onTrial });
  if (domainType === "CUSTOM" && !features.customDomainEnabled) {
    // How many are already connected is checked where a new domain is added (lib/plan/domainGate.ts).
    throw new PlanLimitError("PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE", customDomainError(actor, 0) ?? "Custom domains aren't available on your plan.");
  }
  if (features.maxPublishedSites === null) return;
  const others = otherLiveSites(await listGovernedSites(actor.userId), templateId);
  if (others.length >= features.maxPublishedSites) {
    const names = others.map((s) => s.name);
    const max = features.maxPublishedSites;
    const planName = planLabel(actor.subscriptionPlan);
    // The plan that actually lifts this: the first one that keeps more sites live than are live now
    // (Starter still keeps just one, so from Free the answer is Pro).
    const needed: PaidPlanId = PAID_PLAN_IDS.find((p) => {
      const cap = getTierFeatures(p).maxPublishedSites;
      return cap === null || cap > others.length;
    }) ?? PLAN.ENTERPRISE;
    const next = planLabel(needed);
    throw new PlanLimitError(
      "PLAN_SITE_LIMIT_EXCEEDED",
      toPlanId(actor.subscriptionPlan) === PLAN.FREE
        ? `This site can't go live yet. The ${planName} plan keeps one site live at a time, and "${names[0]}" is live now. Upgrade to ${next} to put more sites live, or publish this one instead (the other one goes offline, nothing is deleted).`
        : `This site can't go live yet. The ${planName} plan keeps ${max} site${max === 1 ? "" : "s"} live at a time, and ${max === 1 ? `"${names[0]}" is` : "they're all"} live now. Upgrade to ${next} for more, or take one offline first (nothing is deleted).`,
      { liveSiteIds: others.map((s) => s.id), liveSiteNames: names, requiredPlan: needed, canReplaceLiveSite: toPlanId(actor.subscriptionPlan) === PLAN.FREE },
    );
  }
}

/** A plan limit as one sentence for text-only places (MCP tools, AI assistants): the reason, the plan that lifts it and where to get it. Any other error keeps its own message. */
export function planLimitText(err: unknown, fallback: string): string {
  if (err instanceof PlanLimitError) {
    const requiredPlan = ((err.details as { requiredPlan?: PaidPlanId }).requiredPlan ?? PLAN.STARTER) as PaidPlanId;
    return planGateMessage({ message: err.message, requiredPlan });
  }
  return err instanceof Error ? err.message : fallback;
}
