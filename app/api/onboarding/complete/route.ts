import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { MarketplaceUseError } from "@/lib/marketplaceUse";
import { makeSiteFromKit, makeSiteFromMarketDesign } from "@/lib/onboarding/siteMaking";
import { completeOnboarding, OnboardingError } from "@/lib/onboarding/complete";

/** "Use this design" / "Skip, just personalise": save the answers, build the site with site_create, finish onboarding. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
  let body: { profile?: unknown; designId?: unknown; marketDesignId?: unknown; skipSite?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that. Please try again." }, { status: 400 });
  }
  const ownBrand = () => (sanitizeBuildProfile(body.profile) as { ok: boolean; value?: SolBuildProfile }).value?.brand;
  try {
    const result = await completeOnboarding(
      { profile: body.profile, designId: typeof body.designId === "string" ? body.designId : undefined, marketDesignId: typeof body.marketDesignId === "string" && body.marketDesignId ? body.marketDesignId : undefined, skipSite: body.skipSite === true },
      {
        saveUser: async (patch) => {
          await User.patch({ id: resolved.userId }).set(patch as never).go();
        },
        createSite: (args) => makeSiteFromKit(resolved, args, ownBrand()),
        // A real marketplace design: the marketplace's own "use" path checks it is free or already bought (never trusted from the browser).
        createFromMarketDesign: (designId, name) => makeSiteFromMarketDesign(resolved, designId, name, ownBrand()),
      },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MarketplaceUseError) return NextResponse.json({ error: err.message, ...err.extra, needsPurchase: err.status === 403 && !err.extra.plan }, { status: err.status });
    if (err instanceof OnboardingError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error && err.message ? err.message : "";
    console.error("onboarding complete failed", err);
    return NextResponse.json(
      { error: message || "We couldn't make your site just now. Nothing was lost: please try again in a moment." },
      { status: 500 },
    );
  }
}
