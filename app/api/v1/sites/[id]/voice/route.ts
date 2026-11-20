import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { Template } from "@/lib/db/contentEntities";
import { readSiteBrand } from "@/lib/dashboardV3/brandLook";
import { resolveSiteBrand } from "@/lib/brand/resolveSiteBrand";
import { suggestedMetaDescription } from "@/lib/brand/brandVoice";
import { readVoiceFromStrata, saveSiteVoice, VoiceError } from "@/lib/brand/voiceStore";

/**
 * The words of a site's brand: tagline, short description and voice (lib/brand/brandVoice.ts).
 *   GET  { voice (what the site has saved), effective (saved words plus the account's onboarding answers), suggestedMetaDescription }
 *        A site with no words of its own but a brand linked in Strata that has some starts from those.
 *   PUT  { tagline?, aboutLine?, tones?, formality?, audience?, wordsLike?, wordsAvoid? }   change some or all of them ("" or [] clears one)
 */
type Ctx = { params: Promise<{ id: string }> };

async function authorize(request: NextRequest, ctx: Ctx, limit = 0) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 }) };
  const { id } = await ctx.params;
  const { data: site } = await Template.get({ id }).go({ attributes: ["id", "name", "organizationId", "parentId", "kind", "brand"] });
  if (!site || site.organizationId !== resolved.organizationId || site.parentId || site.kind !== "LANDING_PAGE") return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  if (limit && !(await checkCommerceRateLimit(`site-voice:${resolved.userId}`, limit))) return { error: NextResponse.json({ error: "That's a lot of changes in a short time. Wait a few minutes and try again." }, { status: 429 }) };
  return { resolved, site };
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  try {
    const { site, resolved } = auth;
    let own = readSiteBrand(site.brand)?.voice;
    if (!own) {
      const fromStrata = await readVoiceFromStrata({ siteId: site.id, userId: resolved.userId, organizationId: resolved.organizationId });
      if (fromStrata) own = fromStrata;
    }
    const brand = await resolveSiteBrand({ siteId: site.id, organizationId: resolved.organizationId, userId: resolved.userId }).catch(() => null);
    const effective = brand?.words ?? own ?? null;
    return NextResponse.json({ voice: own ?? null, effective, suggestedMetaDescription: suggestedMetaDescription(effective, site.name ?? undefined) });
  } catch (err) {
    console.error("site voice GET error:", err);
    return NextResponse.json({ error: "We couldn't load your words. Please try again." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 30);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => null);
    const saved = await saveSiteVoice({ siteId: auth.site.id, userId: auth.resolved.userId, organizationId: auth.resolved.organizationId, patch: body });
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof VoiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("site voice PUT error:", err);
    return NextResponse.json({ error: "We couldn't save your words. Please try again." }, { status: 500 });
  }
}
