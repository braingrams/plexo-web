import { NextRequest, NextResponse } from "next/server";

import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { adoptLook, ensureBlankSiteLayout, fragmentIsBlank, looksFor, pagesWithOwnChrome, removeOwnChrome, siteKindForLayout, unsupportedLayoutMessage } from "@/lib/siteLayoutBlank";

/**
 * The "Add a header" / "Add a footer" start on Site layout. GET: whether each is still blank, the ready-made looks
 * (built from the site's own menu) and which pages still carry their own header/footer. POST { kind, variant }
 * adopts a look in one click; POST { kind, removeOwn: true } takes the old inline header/footer off the pages
 * once the shared one is in place. Also gives an older site its (blank) header and footer the first time it's opened.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: root } = await Template.get({ id: templateId }).go();
  const kind = siteKindForLayout(root ?? {});
  const unsupported = unsupportedLayoutMessage(kind);
  if (unsupported) return NextResponse.json({ siteKind: kind, supported: false, message: unsupported });

  await ensureBlankSiteLayout(templateId, resolved.context.userId);
  const { data: layout } = await SiteLayout.get({ templateId }).go();
  const [headerBlank, footerBlank, looks, ownHeader, ownFooter] = await Promise.all([
    fragmentIsBlank(layout?.headerTemplateId),
    fragmentIsBlank(layout?.footerTemplateId),
    kind === "visual" ? looksFor(templateId) : null,
    kind === "visual" ? pagesWithOwnChrome(templateId, "header") : [],
    kind === "visual" ? pagesWithOwnChrome(templateId, "footer") : [],
  ]);
  return NextResponse.json({
    siteKind: kind,
    supported: true,
    enabled: !!layout?.enabled,
    headerBlank,
    footerBlank,
    headerTemplateId: layout?.headerTemplateId ?? null,
    footerTemplateId: layout?.footerTemplateId ?? null,
    looks,
    pagesWithOwnHeader: ownHeader,
    pagesWithOwnFooter: ownFooter,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, templateId);
  if ("error" in resolved) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; variant?: unknown; removeOwn?: unknown };
  if (body.kind !== "header" && body.kind !== "footer") return NextResponse.json({ error: "Choose the header or the footer." }, { status: 400 });

  if (body.removeOwn === true) {
    try {
      return NextResponse.json({ changed: await removeOwnChrome(templateId, body.kind) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't remove those. Try again." }, { status: 400 });
    }
  }
  if (typeof body.variant !== "string") return NextResponse.json({ error: "Pick one of the looks shown." }, { status: 400 });
  const result = await adoptLook(templateId, body.kind, body.variant, resolved.context.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ fragmentTemplateId: result.fragmentId, pagesWithOwnChrome: result.pagesWithOwnChrome });
}
