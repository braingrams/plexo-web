import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { getMenu, hideFromMenu, showInMenu } from "@/lib/dashboardV3/hubMenu";

/**
 * The site's menu, for the hub's "Manage pages".
 *   GET    → { available, hrefs }  available is false when the site has no shared header to hold a menu
 *   PATCH  { href, label?, show }  show or hide one page's link in the menu
 */
type Ctx = { params: Promise<{ id: string }> };

async function authorize(request: NextRequest, ctx: Ctx) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 }) };
  const { id } = await ctx.params;
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId || site.kind !== "LANDING_PAGE") {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }
  return { site };
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  return NextResponse.json(await getMenu(auth.site.id));
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => ({}))) as { href?: unknown; label?: unknown; show?: unknown };
  if (typeof body.href !== "string" || !body.href.startsWith("/") || typeof body.show !== "boolean") {
    return NextResponse.json({ error: "Tell us which page, and whether to show or hide it." }, { status: 400 });
  }
  const menu = await getMenu(auth.site.id);
  if (!menu.available) {
    return NextResponse.json({ error: "This site's menu is set up in the design editor, so it can't be changed from here." }, { status: 409 });
  }
  if (body.show) {
    if (!menu.hrefs.includes(body.href)) {
      const added = await showInMenu(auth.site.id, typeof body.label === "string" && body.label.trim() ? body.label : "Page", body.href);
      if (!added) return NextResponse.json({ error: "The menu is full. Remove another page from it first." }, { status: 409 });
    }
  } else {
    await hideFromMenu(auth.site.id, body.href);
  }
  return NextResponse.json(await getMenu(auth.site.id));
}
