import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsPage, Template } from "@/lib/db/contentEntities";

const BLANK_TEMPLATE_SHELL = { body: { style: { background: "#0b0f19", padding: "24px" }, rows: [] } };

/**
 * POST /api/v1/lms/funnels/[templateId]/pages/[pageId]/design
 *
 * Switches a page (currently just WELCOME) into "full page builder" content mode —
 * idempotent: if a design Template is already linked (from a prior switch), just flips
 * contentMode back to ADVANCED and returns the existing one untouched, same
 * "never lose prior work switching modes back and forth" discipline as Commerce's own
 * ensureProductDetailLayout. The design Template is a REAL Template, edited via the
 * ordinary PlexoBuilder visual editor at /dashboard/templates/[id] — isLmsPageDesign just
 * keeps it out of /dashboard/templates' and Domains' own listings, since it isn't a
 * standalone site.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; pageId: string }> },
): Promise<NextResponse> {
  const { templateId, pageId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, userId, role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const { data: page } = await LmsPage.get({ templateId, id: pageId }).go();
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  if (page.designTemplateId) {
    await LmsPage.patch({ templateId, id: pageId }).set({ contentMode: "ADVANCED" }).go();
    return NextResponse.json({ designTemplateId: page.designTemplateId });
  }

  const designTemplateId = randomUUID();
  await Template.create({
    id: designTemplateId,
    userId,
    organizationId,
    name: `${page.title} design`,
    kind: "LANDING_PAGE",
    isLmsPageDesign: true,
    designJson: BLANK_TEMPLATE_SHELL,
    compiledHtml: "",
  }).go();

  await LmsPage.patch({ templateId, id: pageId }).set({ contentMode: "ADVANCED", designTemplateId }).go();

  return NextResponse.json({ designTemplateId }, { status: 201 });
}
