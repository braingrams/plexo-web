import { NextResponse } from "next/server";
import { getTierFeatures } from "@/lib/subscription";
import { planMonthlyCredits } from "@/lib/credits/value";
import { PLAN_IDS } from "@/lib/plan/plans";

/**
 * GET /api/billing/plans → what each plan includes, straight from the plan config. The marketing
 * site reads this so its plan copy can't drift from what the app enforces. Public and signed-out:
 * it only describes the plans, nothing about an account.
 */
export async function GET(): Promise<NextResponse> {
  const plans = Object.fromEntries(
    PLAN_IDS.map((plan) => {
      const f = getTierFeatures(plan);
      return [
        plan,
        {
          landingPages: f.maxLandingPages,
          publishedPagesPerSite: f.maxPublishedPagesPerSite,
          publishedSites: f.maxPublishedSites,
          emailTemplates: f.maxEmailTemplates,
          funnels: f.includedFunnelSlots,
          products: f.maxCommerceProducts,
          customDomains: f.maxCustomDomains,
          includedFreeDomains: f.includedFreeDomains,
          teamSeats: f.teamSeats,
          monthlyCredits: planMonthlyCredits(plan),
          blog: f.blogEnabled,
          brandingRemoval: f.brandingRemovalEnabled,
          whiteLabel: f.whiteLabelEnabled,
          mcp: f.mcpEnabled,
        },
      ];
    }),
  );
  return NextResponse.json({ plans }, { headers: { "Cache-Control": "no-store" } });
}
