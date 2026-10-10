import { NextResponse } from "next/server";

import { getTierFeatures, isHomePageOnlyPlan } from "@/lib/subscription";
import { otherLiveSites } from "./siteLimits";
import { listGovernedSites } from "./sitesStore";

// Server-side plan checks for every way something goes live. The serve route enforces the
// same limits for visitors regardless (app/pub/[domain]); these give the owner — or the AI
// assistant acting for them — a clear reason and a next step instead of a silent no-op.

export type PlanLimitCode = "PLAN_PAGE_LIMIT_EXCEEDED" | "PLAN_SITE_LIMIT_EXCEEDED" | "PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE";

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
  return NextResponse.json({ error: err.message, code: err.code, upgradeUrl: "/dashboard/settings/subscription", ...err.details }, { status: err.status });
}

/**
 * Publishing a page. Free serves only a site's homepage, so publishing any other page is
 * refused — the page stays saved and goes live the moment the account upgrades.
 */
export function assertCanPublishPage(plan: string, page: { parentId?: string | null }): void {
  if (page.parentId && isHomePageOnlyPlan(plan)) {
    throw new PlanLimitError(
      "PLAN_PAGE_LIMIT_EXCEEDED",
      "The Free plan publishes one page per site — your homepage. This page is saved; upgrade to Pro to publish it.",
    );
  }
}

/**
 * Putting a site live at an address. Free: Plexo addresses only, and one live site at a
 * time. `templateId` is the site (root template) the address points at.
 */
export async function assertCanPutSiteLive(
  actor: { userId: string; subscriptionPlan: string },
  templateId: string,
  domainType: "SUBDOMAIN" | "CUSTOM",
): Promise<void> {
  const features = getTierFeatures(actor.subscriptionPlan);
  if (domainType === "CUSTOM" && !features.customDomainEnabled) {
    throw new PlanLimitError(
      "PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE",
      "Custom domains are part of Pro. Your site can go live on a free Plexo address now, or upgrade to use your own domain.",
    );
  }
  if (features.maxPublishedSites === null) return;
  const others = otherLiveSites(await listGovernedSites(actor.userId), templateId);
  if (others.length >= features.maxPublishedSites) {
    const names = others.map((s) => s.name);
    throw new PlanLimitError(
      "PLAN_SITE_LIMIT_EXCEEDED",
      `The Free plan keeps one site live at a time, and "${names[0]}" is live now. Upgrade to Pro to put more sites live, or make this your live site instead (the other one goes offline, nothing is deleted).`,
      { liveSiteIds: others.map((s) => s.id), liveSiteNames: names },
    );
  }
}
