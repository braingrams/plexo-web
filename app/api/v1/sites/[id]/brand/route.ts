import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { Template } from "@/lib/db/contentEntities";
import { BrandError, getSiteBrandState, linkSiteBrand, refreshBrandMapping, runSiteBrandUpdate, setSiteBrandOptions, unlinkSiteBrand } from "@/lib/brand/siteBrand";

/**
 * The site's brand from Strata — the Brand card in site settings, and the V2 editor's "Keep my website up to date" switch.
 *   GET     what's linked, whether it keeps in sync, and what happened last (plain words)
 *   POST    { projectId, projectName?, autoSync? }   link this site to a Strata project (or move it to another)
 *   PATCH   { autoSync?, useOnSite?, applyBrand?, syncNow? }   the switches; "Apply my brand"; "Check Strata now"
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

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getSiteBrandState(auth.site.id));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 20);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { projectId?: unknown; projectName?: unknown; autoSync?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "Choose a Strata project to use." }, { status: 400 });
  try {
    return NextResponse.json(
      await linkSiteBrand({
        siteId: auth.site.id,
        userId: auth.resolved.userId,
        organizationId: auth.resolved.organizationId,
        projectId,
        projectName: typeof body?.projectName === "string" ? body.projectName.slice(0, 120) : undefined,
        autoSync: body?.autoSync !== false,
      }),
    );
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 30);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { autoSync?: unknown; useOnSite?: unknown; applyBrand?: unknown; syncNow?: unknown } | null;
  try {
    if (body?.applyBrand === true) {
      const mapping = await refreshBrandMapping(auth.site.id);
      if (!mapping) return NextResponse.json({ error: "Plexo couldn't find colours or fonts on this site to match to your brand." }, { status: 409 });
      return NextResponse.json(await setSiteBrandOptions({ siteId: auth.site.id, useOnSite: true }));
    }
    if (body?.syncNow === true) {
      await runSiteBrandUpdate(auth.site.id, { source: "owner", force: true });
      return NextResponse.json(await getSiteBrandState(auth.site.id));
    }
    return NextResponse.json(
      await setSiteBrandOptions({
        siteId: auth.site.id,
        autoSync: typeof body?.autoSync === "boolean" ? body.autoSync : undefined,
        useOnSite: typeof body?.useOnSite === "boolean" ? body.useOnSite : undefined,
      }),
    );
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx, 20);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await unlinkSiteBrand({ siteId: auth.site.id, userId: auth.resolved.userId }));
  } catch (err) {
    return fail(err);
  }
}
