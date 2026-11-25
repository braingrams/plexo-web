import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";
import { MarketplaceUseError } from "@/lib/marketplaceUse";
import { applyApprovedHtml, applyOwnerLook, makeSiteFromKit, makeSiteFromMarketDesign, markSolPersonalized } from "@/lib/onboarding/siteMaking";
import { readBuildProfile } from "@/lib/dashboardV3/profile";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { createArgs, JUST_MADE_COOKIE, parseCreateRequest } from "@/lib/dashboardV3/newSite";
import { applyNewSiteBrandChoice } from "@/lib/brand/siteBrand";
import { setUpBrandInBackground } from "@/lib/strata/autoSetupBackground";
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
    let made: { siteId: string; name: string; warnings?: string[]; designApplied?: boolean };
    if (parsed.value.marketDesignId) {
      // A real marketplace design: the marketplace's own "use" path re-checks it is free or owned and enforces plan limits.
      // A new-editor design is rebuilt from the listing with the owner's name and description (and SOL's words, when it personalized it), so the
      // new site's design data holds them from the first moment; the page is then compiled once from that design. The browser sends only the small
      // recipe (parsed.value.designEdits), never design JSON or HTML for such a design.
      const siteBrand = parsed.value.brandLogoUrl ? { ...(brand ?? {}), logoUrl: parsed.value.brandLogoUrl } : brand;
      made = await makeSiteFromMarketDesign(resolved, parsed.value.marketDesignId, parsed.value.name, siteBrand, { applyLook: false, design: { about: parsed.value.about, ...(parsed.value.designEdits ?? {}) } });
    } else {
      const args = createArgs(parsed.value, brand);
      if (!args) return NextResponse.json({ error: "Pick what your website is for first." }, { status: 400 });
      made = await makeSiteFromKit(resolved, args, brand);
    }
    // What the owner saw is what they get: SOL's version when SOL rewrote it, otherwise the design with their name, colour and description on it.
    // For a marketplace design the site's brand (its colour and logo, saved on the Brand tab) is then put into the design itself, the way the
    // Brand page does, so the colour is the site's brand colour and changing it there recolours the site. (A kit site is already built in the brand.)
    // A design personalized on its own data (made.designApplied) needs no page text carried back: the HTML below is only the fallback for
    // designs that are not new-editor ones (classic, uploaded).
    const approvedHtml = made.designApplied ? undefined : (parsed.value.personalizedHtml ?? parsed.value.brandedHtml);
    const brandWho = parsed.value.marketDesignId ? { userId: resolved.userId, organizationId: resolved.organizationId } : undefined;
    const approved = approvedHtml ? await applyApprovedHtml(made.siteId, approvedHtml, { brandColor: parsed.value.brandColor, look: brandWho }) : undefined;
    const lookApplied = approved?.designData === "synced";
    const look = brandWho && !lookApplied ? await applyOwnerLook(made.siteId, brandWho, { brandColor: parsed.value.brandColor }) : undefined;
    if (made.designApplied && parsed.value.designEdits?.copy) await markSolPersonalized(made.siteId, { contact: parsed.value.designEdits.contact });
    // The HTML fallback (a design SOL rewrote as page text): its markers are in that HTML, and are saved on the site too so a recompile can't lose them.
    else if (approvedHtml && parsed.value.personalizedHtml && approved?.saved) await markSolPersonalized(made.siteId, { contact: parsed.value.designEdits?.contact });
    // "Your brand" step: the owner's chosen Strata project (or "make one from my brand") is linked to the new site, so it follows that brand from the start.
    const brandChoice = parseBrandChoice((body as { brand?: unknown })?.brand);
    const brandResult = brandChoice ? await applyNewSiteBrandChoice({ siteId: made.siteId, userId: resolved.userId, organizationId: resolved.organizationId, choice: brandChoice }) : undefined;
    // No choice made: the brand is set up in Strata by itself, in the background (a project named after the site), without holding up the website.
    if (!brandChoice) setUpBrandInBackground({ siteId: made.siteId, userId: resolved.userId, organizationId: resolved.organizationId });
    const res = NextResponse.json({ site: { id: made.siteId, name: made.name }, warnings: [...(made.warnings ?? []), ...(approved?.problems ?? []), ...(look?.problems ?? [])], ...(brandResult ? { brand: brandResult } : {}) });
    res.cookies.set(CURRENT_SITE_COOKIE, made.siteId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    // Home shows this site's guided steps ("Finish up"...) first, whichever view the person normally has, until it is online.
    res.cookies.set(JUST_MADE_COOKIE, made.siteId, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
    return res;
  } catch (err) {
    if (err instanceof MarketplaceUseError) return NextResponse.json({ error: err.message, ...err.extra, needsPurchase: err.status === 403 && !err.extra.plan }, { status: err.status });
    console.error("new site failed", err);
    const message = err instanceof Error && err.message ? err.message : "";
    return NextResponse.json({ error: message || "We couldn't make your website just now. Nothing was lost: please try again in a moment." }, { status: 500 });
  }
}
