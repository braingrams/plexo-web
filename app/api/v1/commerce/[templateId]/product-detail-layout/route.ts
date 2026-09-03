import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { getEnabledSiteLayoutRows, spliceLayoutRows } from "@/lib/siteLayoutDynamo";
import { PRODUCT_DETAIL_STARTER_DESIGN_JSON } from "@/lib/commerce/productDetailLayout";
import { Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";

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

  // CommerceSettings has no org-wide index (keyed by templateId, see commerceEntities.ts)
  // — fan out per org root template, same bound as every other "list across my org's
  // sites" query on Template-keyed entities (see DomainsPage, dashboard overview).
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.context.organizationId }).go({ pages: "all" });
  const rootIds = orgTemplates.filter((t) => !t.parentId && t.id !== templateId).map((t) => t.id);
  const settingsBatches = await Promise.all(rootIds.map((id) => CommerceSettings.get({ templateId: id }).go()));
  const templateNameById = new Map(orgTemplates.map((t) => [t.id, t.name]));

  const candidateIds = settingsBatches
    .map((b) => b.data)
    .filter((s): s is NonNullable<typeof s> => s !== null && Boolean(s.productDetailTemplateId));
  const layoutRows = await Promise.all(candidateIds.map((s) => Template.get({ id: s.productDetailTemplateId! }).go()));

  const candidates = candidateIds
    .map((s, i) => {
      const layout = layoutRows[i].data;
      if (!layout) return null;
      return {
        layoutTemplateId: layout.id,
        layoutName: layout.name,
        siteName: templateNameById.get(s.templateId) ?? "",
        updatedAt: layout.updatedAt,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

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

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existingSettings } = await CommerceSettings.get({ templateId }).go();
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
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId }).go({ pages: "all" });
    const rootIds = orgTemplates.filter((t) => !t.parentId).map((t) => t.id);
    const settingsBatches = await Promise.all(rootIds.map((id) => CommerceSettings.get({ templateId: id }).go()));
    const sourceSettings = settingsBatches.map((b) => b.data).find((s) => s?.productDetailTemplateId === sourceLayoutTemplateId);
    const sourceTemplate = sourceSettings ? (await Template.get({ id: sourceLayoutTemplateId }).go()).data : null;
    if (!sourceTemplate) {
      return NextResponse.json({ error: "That layout is no longer available to reuse — it may have been detached from its site." }, { status: 400 });
    }
    name = sourceTemplate.name;
    designJson = sourceTemplate.designJson as object;
  }

  // Splice this site's own header/footer in at creation time (rather than leaving it
  // unspliced until the layout is first opened and saved in the builder) so a brand-new
  // layout looks and works right immediately, before anyone's touched it.
  const layout = await getEnabledSiteLayoutRows(templateId);
  const spliced = spliceLayoutRows(designJson, layout);
  const compiledHtml = sanitizeHtml(compileToHTML(spliced));

  const layoutTemplateId = randomUUID();
  await Template.create({
    id: layoutTemplateId,
    userId,
    organizationId,
    name,
    kind: "LANDING_PAGE",
    isCommerceLayout: true,
    designJson,
    compiledHtml,
  }).go();

  const { data: existing } = await CommerceSettings.get({ templateId }).go();
  if (existing) {
    await CommerceSettings.patch({ templateId }).set({ productDetailTemplateId: layoutTemplateId }).go();
  } else {
    await CommerceSettings.create({ id: randomUUID(), templateId, organizationId, productDetailTemplateId: layoutTemplateId }).go();
  }

  return NextResponse.json({ layoutTemplateId }, { status: 201 });
}

/** Detaches the layout (product URLs 404 again) without deleting the Template row — it
 * stays around, editable, reattachable later via POST. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceSettings.get({ templateId }).go();
  if (existing) {
    await CommerceSettings.patch({ templateId }).remove(["productDetailTemplateId"]).go();
  }
  return NextResponse.json({ ok: true });
}
