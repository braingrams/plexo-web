import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveSiteLayoutAdmin, recompileSiteLayoutDependents } from "@/lib/siteLayoutDynamo";
import { Template, SiteLayout } from "@/lib/db/contentEntities";

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

  // SiteLayout has no org-wide index (keyed by templateId, see contentEntities.ts) — fan
  // out per org root template, same bound as every other "list across my org's sites"
  // query on Template-keyed entities.
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.context.organizationId }).go();
  const templateNameById = new Map(orgTemplates.map((t) => [t.id, t.name]));
  const rootIds = orgTemplates.filter((t) => !t.parentId && t.id !== resolved.context.templateId).map((t) => t.id);
  const siteLayouts = (await Promise.all(rootIds.map((id) => SiteLayout.get({ templateId: id }).go()))).map((b) => b.data);

  const fragmentField = kind === "header" ? "headerTemplateId" : "footerTemplateId";
  const attached = siteLayouts.filter((s): s is NonNullable<typeof s> => s !== null && Boolean(s[fragmentField]));
  const fragments = await Promise.all(attached.map((s) => Template.get({ id: s[fragmentField]! }).go()));

  const candidates = attached
    .map((s, i) => {
      const fragment = fragments[i].data;
      if (!fragment) return null;
      return { fragmentTemplateId: fragment.id, fragmentName: fragment.name, siteName: templateNameById.get(s.templateId) ?? "", updatedAt: fragment.updatedAt };
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

  const permissionError = requirePermission(resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { data: site } = await SiteLayout.get({ templateId: resolved.context.templateId }).go();
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
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.context.organizationId }).go();
    const rootIds = orgTemplates.filter((t) => !t.parentId).map((t) => t.id);
    const siteLayouts = (await Promise.all(rootIds.map((id) => SiteLayout.get({ templateId: id }).go()))).map((b) => b.data);
    const fragmentField = kind === "header" ? "headerTemplateId" : "footerTemplateId";
    const sourceSite = siteLayouts.find((s) => s?.[fragmentField] === sourceFragmentTemplateId);
    const source = sourceSite ? (await Template.get({ id: sourceFragmentTemplateId }).go()).data : null;
    if (!source) {
      return NextResponse.json({ error: "That header/footer is no longer available to reuse — it may have been detached from its site." }, { status: 400 });
    }
    name = source.name;
    designJson = source.designJson as object;
    compiledHtml = source.compiledHtml;
  }

  const fragmentTemplateId = randomUUID();
  await Template.create({
    id: fragmentTemplateId,
    userId: resolved.context.userId,
    organizationId: resolved.context.organizationId,
    name,
    kind: "LANDING_PAGE",
    isSiteLayoutFragment: true,
    designJson,
    compiledHtml,
  }).go();

  if (site) {
    await SiteLayout.patch({ templateId: resolved.context.templateId })
      .set(kind === "header" ? { headerTemplateId: fragmentTemplateId } : { footerTemplateId: fragmentTemplateId })
      .go();
  } else {
    await SiteLayout.create({
      id: randomUUID(),
      templateId: resolved.context.templateId,
      organizationId: resolved.context.organizationId,
      ...(kind === "header" ? { headerTemplateId: fragmentTemplateId } : { footerTemplateId: fragmentTemplateId }),
    }).go();
  }

  await recompileSiteLayoutDependents(resolved.context.templateId);

  return NextResponse.json({ fragmentTemplateId }, { status: 201 });
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

  const permissionError = requirePermission(resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { data: site } = await SiteLayout.get({ templateId: resolved.context.templateId }).go();
  if (site) {
    await SiteLayout.patch({ templateId: resolved.context.templateId }).remove([kind === "header" ? "headerTemplateId" : "footerTemplateId"]).go();
  }

  await recompileSiteLayoutDependents(resolved.context.templateId);

  return NextResponse.json({ ok: true });
}
