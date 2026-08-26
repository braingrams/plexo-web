import { NextRequest, NextResponse } from "next/server";
import { TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { getEnabledSiteLayoutRows, spliceLayoutRows } from "@/lib/siteLayout";
import { PRODUCT_DETAIL_STARTER_DESIGN_JSON } from "@/lib/commerce/productDetailLayout";

/**
 * Self-service creation/reuse/detach for the site's Product Detail layout — the admin-UI
 * counterpart to CommerceSettings.productDetailTemplateId, mirroring
 * app/api/blog/[templateId]/layout/[kind]/route.ts almost exactly (one kind here instead of
 * post/listing, since a site only ever needs one product-detail layout).
 */

/** Other Commerce-enabled sites in this org that already have a layout attached — reuse
 * candidates for "Use existing" instead of designing one from scratch. */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const candidateRows = await prisma.commerceSettings.findMany({
    where: {
      template: { organizationId: resolved.context.organizationId },
      templateId: { not: templateId },
      productDetailTemplateId: { not: null },
    },
    select: {
      template: { select: { name: true } },
      productDetailTemplate: { select: { id: true, name: true, updatedAt: true } },
    },
  });

  const candidates = candidateRows
    .filter((row) => row.productDetailTemplate)
    .map((row) => ({
      layoutTemplateId: row.productDetailTemplate!.id,
      layoutName: row.productDetailTemplate!.name,
      siteName: row.template.name,
      updatedAt: row.productDetailTemplate!.updatedAt,
    }));

  return NextResponse.json({ candidates });
}

/**
 * Idempotent — calling this again while one's already attached just returns it, so
 * re-clicking "Design custom layout" never creates duplicates. Optional body
 * { sourceLayoutTemplateId } clones an existing layout (see GET above) instead of starting
 * from the seeded starter — "Use existing" in the settings picker.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, userId, role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const existingSettings = await prisma.commerceSettings.findUnique({ where: { templateId }, select: { productDetailTemplateId: true } });
  if (existingSettings?.productDetailTemplateId) {
    return NextResponse.json({ layoutTemplateId: existingSettings.productDetailTemplateId });
  }

  const body = (await request.json().catch(() => ({}))) as { sourceLayoutTemplateId?: string };
  const sourceLayoutTemplateId = typeof body.sourceLayoutTemplateId === "string" ? body.sourceLayoutTemplateId.trim() : "";

  let name = "Product Detail Layout";
  let designJson: object = PRODUCT_DETAIL_STARTER_DESIGN_JSON;

  if (sourceLayoutTemplateId) {
    // Never trust a bare template id from the client — re-verify it the same way GET
    // surfaced it: it must be reachable as another site in this org's actually-attached
    // product detail layout. Prevents cross-org access.
    const sourceSettings = await prisma.commerceSettings.findFirst({
      where: { template: { organizationId }, productDetailTemplateId: sourceLayoutTemplateId },
      select: { productDetailTemplate: { select: { name: true, designJson: true } } },
    });
    if (!sourceSettings?.productDetailTemplate) {
      return NextResponse.json({ error: "That layout is no longer available to reuse — it may have been detached from its site." }, { status: 400 });
    }
    name = sourceSettings.productDetailTemplate.name;
    designJson = sourceSettings.productDetailTemplate.designJson as object;
  }

  // Splice this site's own header/footer in at creation time (rather than leaving it
  // unspliced until the layout is first opened and saved in the builder) so a brand-new
  // layout looks and works right immediately, before anyone's touched it.
  const layout = await getEnabledSiteLayoutRows(templateId);
  const spliced = spliceLayoutRows(designJson, layout);
  const compiledHtml = sanitizeHtml(compileToHTML(spliced));

  const layoutTemplate = await prisma.template.create({
    data: {
      userId,
      organizationId,
      name,
      kind: TemplateKind.LANDING_PAGE,
      isCommerceLayout: true,
      designJson,
      compiledHtml,
    },
    select: { id: true },
  });

  await prisma.commerceSettings.upsert({
    where: { templateId },
    create: { templateId, organizationId, productDetailTemplateId: layoutTemplate.id },
    update: { productDetailTemplateId: layoutTemplate.id },
  });

  return NextResponse.json({ layoutTemplateId: layoutTemplate.id }, { status: 201 });
}

/** Detaches the layout (product URLs 404 again) without deleting the Template row — it
 * stays around, editable, reattachable later via POST. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  await prisma.commerceSettings.updateMany({ where: { templateId }, data: { productDetailTemplateId: null } });
  return NextResponse.json({ ok: true });
}
