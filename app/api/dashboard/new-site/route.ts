import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";
import { MarketplaceUseError } from "@/lib/marketplaceUse";
import { makeSiteFromKit, makeSiteFromMarketDesign } from "@/lib/onboarding/siteMaking";
import { readBuildProfile } from "@/lib/dashboardV3/profile";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { createArgs, parseCreateRequest } from "@/lib/dashboardV3/newSite";
import { applyNewSiteBrandChoice } from "@/lib/brand/siteBrand";
import { parseBrandChoice } from "@/lib/brand/brandModel";

/**
 * "Make a new website" (new dashboard): builds the site with site_create, the same path onboarding
 * uses, with the goal switched on (store, blog, course set up), and makes it the current site.
 * It never changes the owner's saved answers. A site is always saved; plan limits only decide how
 * many are online (lib/plan/publishGuard.ts), so nothing here is refused for plan reasons.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that. Please try again." }, { status: 400 });
  }
  const parsed = parseCreateRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const { data: user } = await User.get({ id: resolved.userId }).go();
    const brand = readBuildProfile(user?.buildProfile)?.brand;
    let made: { siteId: string; name: string; warnings?: string[] };
    if (parsed.value.marketDesignId) {
      // A real marketplace design: the marketplace's own "use" path re-checks it is free or owned and enforces plan limits.
      made = await makeSiteFromMarketDesign(resolved, parsed.value.marketDesignId, parsed.value.name, brand);
    } else {
      const args = createArgs(parsed.value, brand);
      if (!args) return NextResponse.json({ error: "Pick what your website is for first." }, { status: 400 });
      made = await makeSiteFromKit(resolved, args, brand);
    }
    // "Your brand" step: the owner's chosen Strata project (or "make one from my brand") is linked to the new site, so it follows that brand from the start.
    const brandChoice = parseBrandChoice((body as { brand?: unknown })?.brand);
    const brandResult = brandChoice ? await applyNewSiteBrandChoice({ siteId: made.siteId, userId: resolved.userId, organizationId: resolved.organizationId, choice: brandChoice }) : undefined;
    const res = NextResponse.json({ site: { id: made.siteId, name: made.name }, warnings: made.warnings ?? [], ...(brandResult ? { brand: brandResult } : {}) });
    res.cookies.set(CURRENT_SITE_COOKIE, made.siteId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  } catch (err) {
    if (err instanceof MarketplaceUseError) return NextResponse.json({ error: err.message, ...err.extra, needsPurchase: err.status === 403 && !err.extra.plan }, { status: err.status });
    console.error("new site failed", err);
    const message = err instanceof Error && err.message ? err.message : "";
    return NextResponse.json({ error: message || "We couldn't make your website just now. Nothing was lost: please try again in a moment." }, { status: 500 });
  }
}
