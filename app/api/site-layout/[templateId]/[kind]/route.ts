import { NextRequest, NextResponse } from "next/server";
import { TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveSiteLayoutAdmin, recompileSiteLayoutDependents } from "@/lib/siteLayout";

const BLANK_TEMPLATE_SHELL = {
  body: {
    style: { background: "#ffffff", padding: "24px" },
    rows: [],
  },
};

type LayoutKind = "header" | "footer";

function isLayoutKind(value: string): value is LayoutKind {
  return value === "header" || value === "footer";
}

/**
 * Lists this org's OTHER sites' currently-attached header/footer of the same kind — reuse
 * candidates for "Use existing" instead of designing a new one from scratch. Same shape as
 * app/api/blog/[templateId]/layout/[kind]/route.ts's GET.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; kind: string }> },
): Promise<NextResponse> {
  const { templateId, kind } = await context.params;
  if (!isLayoutKind(kind)) return NextResponse.json({ error: "Unknown layout kind." }, { status: 400 });

  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;

  const sites = await prisma.siteLayout.findMany({
    where: {
      template: { organizationId: resolved.context.organizationId },
      templateId: { not: resolved.context.templateId },
      ...(kind === "header" ? { headerTemplateId: { not: null } } : { footerTemplateId: { not: null } }),
    },
    select: {
      template: { select: { name: true } },
      headerTemplate: kind === "header" ? { select: { id: true, name: true, updatedAt: true } } : false,
      footerTemplate: kind === "footer" ? { select: { id: true, name: true, updatedAt: true } } : false,
    },
  });

  const candidates = sites
    .map((s) => {
      const fragment = kind === "header" ? s.headerTemplate : s.footerTemplate;
      if (!fragment) return null;
      return { fragmentTemplateId: fragment.id, fragmentName: fragment.name, siteName: s.template.name, updatedAt: fragment.updatedAt };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return NextResponse.json({ candidates });
}

/**
 * A header/footer is just an ordinary LANDING_PAGE Template with isSiteLayoutFragment:
 * true — created once and reused (idempotent: calling again while one's already attached
 * just returns it). Attached to SiteLayout immediately, even blank; designing it is the
 * same normal builder autosave as any other page — no separate "activate" step. Same
 * shape as app/api/blog/[templateId]/layout/[kind]/route.ts's POST.
 *
 * Optional body { sourceFragmentTemplateId } clones an existing header/footer instead of
 * starting blank — "Use existing" in the site-layout picker.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; kind: string }> },
): Promise<NextResponse> {
  const { templateId, kind } = await context.params;
  if (!isLayoutKind(kind)) return NextResponse.json({ error: "Unknown layout kind." }, { status: 400 });

  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const site = await prisma.siteLayout.findUnique({ where: { templateId: resolved.context.templateId } });
  const existingId = kind === "header" ? site?.headerTemplateId : site?.footerTemplateId;
  if (existingId) {
    return NextResponse.json({ fragmentTemplateId: existingId });
  }

  const body = (await request.json().catch(() => ({}))) as { sourceFragmentTemplateId?: string };
  const sourceFragmentTemplateId = typeof body.sourceFragmentTemplateId === "string" ? body.sourceFragmentTemplateId.trim() : "";

  let name = kind === "header" ? "Site Header" : "Site Footer";
  let designJson: object = BLANK_TEMPLATE_SHELL;
  let compiledHtml = "";

  if (sourceFragmentTemplateId) {
    // Never trust a bare template id from the client — re-verify it the same way GET
    // surfaced it: reachable as THIS EXACT KIND's attached fragment on some SiteLayout in
    // the same organization. Prevents cross-org access and kind-mismatches.
    const sourceSite = await prisma.siteLayout.findFirst({
      where: {
        template: { organizationId: resolved.context.organizationId },
        ...(kind === "header" ? { headerTemplateId: sourceFragmentTemplateId } : { footerTemplateId: sourceFragmentTemplateId }),
      },
      select: {
        headerTemplate: kind === "header" ? { select: { name: true, designJson: true, compiledHtml: true } } : false,
        footerTemplate: kind === "footer" ? { select: { name: true, designJson: true, compiledHtml: true } } : false,
      },
    });
    const source = kind === "header" ? sourceSite?.headerTemplate : sourceSite?.footerTemplate;
    if (!source) {
      return NextResponse.json({ error: "That header/footer is no longer available to reuse — it may have been detached from its site." }, { status: 400 });
    }
    name = source.name;
    designJson = source.designJson as object;
    compiledHtml = source.compiledHtml;
  }

  const fragmentTemplate = await prisma.template.create({
    data: {
      userId: resolved.context.userId,
      organizationId: resolved.context.organizationId,
      name,
      kind: TemplateKind.LANDING_PAGE,
      isSiteLayoutFragment: true,
      designJson,
      compiledHtml,
    },
    select: { id: true },
  });

  await prisma.siteLayout.upsert({
    where: { templateId: resolved.context.templateId },
    create: {
      templateId: resolved.context.templateId,
      organizationId: resolved.context.organizationId,
      ...(kind === "header" ? { headerTemplateId: fragmentTemplate.id } : { footerTemplateId: fragmentTemplate.id }),
    },
    update: kind === "header" ? { headerTemplateId: fragmentTemplate.id } : { footerTemplateId: fragmentTemplate.id },
  });

  await recompileSiteLayoutDependents(resolved.context.templateId);

  return NextResponse.json({ fragmentTemplateId: fragmentTemplate.id }, { status: 201 });
}

/** Detaches the header/footer (site's pages go back to having none) without deleting the
 * Template row — it stays around, editable, reattachable later via POST. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; kind: string }> },
): Promise<NextResponse> {
  const { templateId, kind } = await context.params;
  if (!isLayoutKind(kind)) return NextResponse.json({ error: "Unknown layout kind." }, { status: 400 });

  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;

  await prisma.siteLayout.updateMany({
    where: { templateId: resolved.context.templateId },
    data: kind === "header" ? { headerTemplateId: null } : { footerTemplateId: null },
  });

  await recompileSiteLayoutDependents(resolved.context.templateId);

  return NextResponse.json({ ok: true });
}
