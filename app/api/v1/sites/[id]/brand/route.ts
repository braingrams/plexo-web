import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { resolveSiteBrand } from "@/lib/brand/resolveSiteBrand";
import { Template } from "@/lib/db/contentEntities";
import { BrandError, createStrataProjectFromSiteBrand, getSiteBrandState, linkSiteBrand, refreshBrandMapping, runSiteBrandUpdate, setSiteBrandOptions, unlinkSiteBrand } from "@/lib/brand/siteBrand";

/**
 * The site's brand from Strata — the Brand card in site settings, and the V2 editor's "Keep my website up to date" switch.
 *   GET     what's linked, whether it keeps in sync, and what happened last (plain words), plus `resolved`: the brand this site
 *           really uses now (lib/brand/resolveSiteBrand.ts: linked project > the site's saved brand > the account's)
 *   POST    { projectId, projectName?, autoSync? }   link this site to a Strata project (or move it to another)
 *           { createProject: true, name?, autoSync? }   make a NEW Strata project from this site's brand and link it
 *   PATCH   { autoSync?, useOnSite?, brandInApp? (server apps: add the brand link to the pages Plexo serves; off until the owner turns it on), applyBrand?, syncNow? }   the switches; "Apply my brand"; "Check Strata now"
 *   DELETE  unlink (pages go back to the colours and fonts they were built with)
 */
type Ctx = { params: Promise<{ id: string }> };

async function authorize(request: NextRequest, ctx: Ctx, limit = 0) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 }) };
  const { id } = await ctx.params;
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId || site.kind !== "LANDING_PAGE") {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }
  if (limit && !(await checkCommerceRateLimit(`site-brand:${resolved.userId}`, limit))) {
    return { error: NextResponse.json({ error: "That's a lot of changes in a short time. Wait a few minutes and try again." }, { status: 429 }) };
  }
  return { resolved, site };
}

function fail(err: unknown): NextResponse {
  if (err instanceof BrandError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("site brand route error:", err);
  return NextResponse.json({ error: "Something went wrong with your brand. Please try again in a moment." }, { status: 500 });
}

/** The state of the link plus the brand the site really uses now, so the screen never has to work the precedence out itself. */
async function stateWithBrand(siteId: string, auth: { resolved: { organizationId: string; userId: string } }, extra: Record<string, unknown> = {}) {
  const [state, resolved] = await Promise.all([getSiteBrandState(siteId), resolveSiteBrand({ siteId, organizationId: auth.resolved.organizationId, userId: auth.resolved.userId }).catch(() => null)]);
  return { ...state, resolved, ...extra };
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  try {
    // Opening the Brand tab quietly finishes anything still waiting to reach Strata (never slows the page).
    void import("@/lib/brand/writeThrough").then(async ({ retryPendingSend }) => { await retryPendingSend(auth.site.id); }).catch(() => undefined);
    return NextResponse.json(await stateWithBrand(auth.site.id, auth));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 20);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { projectId?: unknown; projectName?: unknown; autoSync?: unknown; createProject?: unknown; name?: unknown; sendToStrata?: unknown } | null;
  // "Send to Strata": the owner's button for anything still waiting (or a site that has no Strata project yet).
  if (body?.sendToStrata === true) {
    try {
      const { sendBrandWithin } = await import("@/lib/brand/writeThrough");
      const sent = await sendBrandWithin({ siteId: auth.site.id, userId: auth.resolved.userId, organizationId: auth.resolved.organizationId }, 20000);
      return NextResponse.json({ ...(await stateWithBrand(auth.site.id, auth)), sent });
    } catch (err) {
      return fail(err);
    }
  }
  if (body?.createProject === true) {
    try {
      const made = await createStrataProjectFromSiteBrand({
        siteId: auth.site.id,
        userId: auth.resolved.userId,
        organizationId: auth.resolved.organizationId,
        name: typeof body.name === "string" ? body.name : undefined,
        autoSync: body.autoSync !== false,
      });
      return NextResponse.json(await stateWithBrand(auth.site.id, auth, { created: { project: made.project, sent: made.sent, notes: made.notes } }));
    } catch (err) {
      return fail(err);
    }
  }
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "Choose a Strata project to use." }, { status: 400 });
  try {
    await linkSiteBrand({
      siteId: auth.site.id,
      userId: auth.resolved.userId,
      organizationId: auth.resolved.organizationId,
      projectId,
      projectName: typeof body?.projectName === "string" ? body.projectName.slice(0, 120) : undefined,
      autoSync: body?.autoSync !== false,
    });
    return NextResponse.json(await stateWithBrand(auth.site.id, auth));
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 30);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { autoSync?: unknown; useOnSite?: unknown; brandInApp?: unknown; applyBrand?: unknown; syncNow?: unknown } | null;
  try {
    if (body?.applyBrand === true) {
      const mapping = await refreshBrandMapping(auth.site.id);
      if (!mapping) return NextResponse.json({ error: "Plexo couldn't find colours or fonts on this site to match to your brand." }, { status: 409 });
      await setSiteBrandOptions({ siteId: auth.site.id, useOnSite: true });
      return NextResponse.json(await stateWithBrand(auth.site.id, auth));
    }
    if (body?.syncNow === true) {
      await runSiteBrandUpdate(auth.site.id, { source: "owner", force: true });
      return NextResponse.json(await stateWithBrand(auth.site.id, auth));
    }
    await setSiteBrandOptions({
      siteId: auth.site.id,
      autoSync: typeof body?.autoSync === "boolean" ? body.autoSync : undefined,
      useOnSite: typeof body?.useOnSite === "boolean" ? body.useOnSite : undefined,
      brandInApp: typeof body?.brandInApp === "boolean" ? body.brandInApp : undefined,
    });
    return NextResponse.json(await stateWithBrand(auth.site.id, auth));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 20);
  if (auth.error) return auth.error;
  try {
    await unlinkSiteBrand({ siteId: auth.site.id, userId: auth.resolved.userId });
    return NextResponse.json(await stateWithBrand(auth.site.id, auth));
  } catch (err) {
    return fail(err);
  }
}
