import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveSiteLayoutAdmin, recompileSiteLayoutDependents } from "@/lib/siteLayoutDynamo";
import { SiteLayout, Template } from "@/lib/db/contentEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: layout } = await SiteLayout.get({ templateId }).go();
  const [header, footer] = await Promise.all([
    layout?.headerTemplateId ? Template.get({ id: layout.headerTemplateId }).go() : null,
    layout?.footerTemplateId ? Template.get({ id: layout.footerTemplateId }).go() : null,
  ]);

  return NextResponse.json({
    layout: {
      enabled: layout?.enabled ?? false,
      header: header?.data ? { templateId: header.data.id, name: header.data.name, updatedAt: header.data.updatedAt } : null,
      footer: footer?.data ? { templateId: footer.data.id, name: footer.data.name, updatedAt: footer.data.updatedAt } : null,
    },
  });
}

/** Only flips the master switch — attaching/detaching/designing the header and footer
 * themselves goes through /api/site-layout/[templateId]/[kind] and the normal template
 * editor. Recompiles every page on the site either way: turning this on bakes the current
 * header/footer into every page's compiledHtml, turning it off strips them back out. */
export async function PUT(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { template: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { enabled } = body;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  }

  const { data: existing } = await SiteLayout.get({ templateId }).go();
  if (existing) {
    await SiteLayout.patch({ templateId }).set({ enabled }).go();
  } else {
    await SiteLayout.create({ id: randomUUID(), templateId, organizationId, enabled }).go();
  }

  await recompileSiteLayoutDependents(templateId);

  return NextResponse.json({ layout: { enabled } });
}
