import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveSiteLayoutAdmin, recompileSiteLayoutDependents } from "@/lib/siteLayout";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;

  const layout = await prisma.siteLayout.findUnique({
    where: { templateId },
    include: {
      headerTemplate: { select: { id: true, name: true, updatedAt: true } },
      footerTemplate: { select: { id: true, name: true, updatedAt: true } },
    },
  });

  return NextResponse.json({
    layout: {
      enabled: layout?.enabled ?? false,
      header: layout?.headerTemplate ? { templateId: layout.headerTemplate.id, name: layout.headerTemplate.name, updatedAt: layout.headerTemplate.updatedAt } : null,
      footer: layout?.footerTemplate ? { templateId: layout.footerTemplate.id, name: layout.footerTemplate.name, updatedAt: layout.footerTemplate.updatedAt } : null,
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

  const permissionError = await requirePermission(request.headers, role, { template: ["update"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { enabled } = body;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  }

  await prisma.siteLayout.upsert({
    where: { templateId },
    create: { templateId, organizationId, enabled },
    update: { enabled },
  });

  await recompileSiteLayoutDependents(templateId);

  return NextResponse.json({ layout: { enabled } });
}
