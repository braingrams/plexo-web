import { planGateBody } from "@/lib/plan/planGate";
import { NextRequest, NextResponse } from "next/server";
import { getTierFeatures } from "@/lib/subscription";

export type HostingTier = "STATIC" | "LAMBDA" | "PROVISIONED";

/**
 * Reads ?hostingTier= from an upload request and checks the owner's plan allows it. Defaults to
 * LAMBDA. Returns the tier, or a 403 response when the plan doesn't include it.
 */
export function resolveHostingTier(
  request: NextRequest,
  plan: string | null | undefined,
): { hostingTier: HostingTier } | { error: NextResponse } {
  const tierParam = (new URL(request.url).searchParams.get("hostingTier") ?? "LAMBDA").toUpperCase() as HostingTier;
  const allowedTiers = getTierFeatures(plan).deployedAppHostingTiers;
  if (!allowedTiers.includes(tierParam)) {
    return {
      error: NextResponse.json(planGateBody("PLAN_HOSTING_TIER", `Your plan does not include the "${tierParam}" hosting tier. Available on this plan: ${allowedTiers.join(", ")}. Upgrade to access faster hosting options.`, "PRO"), { status: 403 }),
    };
  }
  return { hostingTier: tierParam };
}
