import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { Template } from "@/lib/db/contentEntities";
import { readSiteBrand } from "@/lib/dashboardV3/brandLook";
import { addCustomFontVariant, isFontUrl, removeCustomFontFamily, sanitizeCustomFonts, type CustomFontFormat } from "@/lib/fonts/customFonts";

/**
 * The fonts an owner uploaded for a site's brand. The file itself is uploaded first with POST /api/v1/media/font (which checks the file);
 * this adds it to the brand ("Upload my own font" in the font picker) so it can be chosen as the heading or body font, and puts it on the
 * brand sheet every page of the site links to.
 *   POST   { family, weight, style?, format, url }   add one look of a font
 *   DELETE { family }                               remove an uploaded font
 */
type Ctx = { params: Promise<{ id: string }> };

async function authorize(request: NextRequest, ctx: Ctx) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 }) };
  const { id } = await ctx.params;
  const { data: site } = await Template.get({ id }).go({ attributes: ["id", "organizationId", "parentId", "kind", "brand"] });
  if (!site || site.organizationId !== resolved.organizationId || site.parentId || site.kind !== "LANDING_PAGE") return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  if (!(await checkCommerceRateLimit(`site-fonts:${resolved.userId}`, 40))) return { error: NextResponse.json({ error: "That's a lot of changes in a short time. Wait a few minutes and try again." }, { status: 429 }) };
  return { resolved, site };
}

async function save(siteId: string, brand: ReturnType<typeof readSiteBrand>, fonts: ReturnType<typeof sanitizeCustomFonts>): Promise<void> {
  const next = { ...(brand ?? {}) };
  if (fonts.length) next.customFonts = fonts;
  else delete next.customFonts;
  await Template.patch({ id: siteId }).set({ brand: next }).go();
  // The brand sheet carries the font files' addresses: write it again so the site shows the font straight away. Best effort.
  try {
    const { runSiteBrandUpdate, forgetServingMemo } = await import("@/lib/brand/siteBrand");
    await runSiteBrandUpdate(siteId, { source: "owner", force: true });
    forgetServingMemo(siteId);
  } catch (err) {
    console.warn(`[brand-fonts] ${siteId}: sheet not refreshed yet`, err instanceof Error ? err.message : err);
  }
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { family?: unknown; weight?: unknown; style?: unknown; format?: unknown; url?: unknown } | null;
  const family = typeof body?.family === "string" ? body.family.trim().replace(/\s+/g, " ") : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,47}$/.test(family)) return NextResponse.json({ error: "Give the font a name using letters, numbers and spaces, like Brandon Grotesque." }, { status: 400 });
  if (!isFontUrl(body?.url)) return NextResponse.json({ error: "That font needs to be uploaded again. Please pick the file once more." }, { status: 400 });
  const before = readSiteBrand(auth.site.brand);
  const next = addCustomFontVariant(before?.customFonts, family, { weight: Number(body?.weight) || 400, style: body?.style === "italic" ? "italic" : "normal", url: body.url as string, format: body?.format as CustomFontFormat });
  if (!next.some((f) => f.family.toLowerCase() === family.toLowerCase())) return NextResponse.json({ error: "We couldn't use that font file. Try a .woff2, .woff, .ttf or .otf file." }, { status: 400 });
  await save(auth.site.id, before, next);
  return NextResponse.json({ customFonts: next });
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authorize(request, ctx);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { family?: unknown } | null;
  if (typeof body?.family !== "string") return NextResponse.json({ error: "Say which font to remove." }, { status: 400 });
  const before = readSiteBrand(auth.site.brand);
  const next = removeCustomFontFamily(before?.customFonts, body.family);
  await save(auth.site.id, before, next);
  return NextResponse.json({ customFonts: next });
}
