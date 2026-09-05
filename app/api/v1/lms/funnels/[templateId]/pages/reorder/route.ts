import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsPage } from "@/lib/db/contentEntities";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { orderedPageIds?: string[] };
  const orderedPageIds = body.orderedPageIds;
  if (!Array.isArray(orderedPageIds) || orderedPageIds.length === 0) {
    return NextResponse.json({ error: "orderedPageIds is required." }, { status: 400 });
  }

  const { data: existingPages } = await LmsPage.query.byOrder({ templateId }).go({ pages: "all" });
  const existingIds = new Set(existingPages.map((p) => p.id));
  if (orderedPageIds.length !== existingPages.length || !orderedPageIds.every((id) => existingIds.has(id))) {
    return NextResponse.json({ error: "orderedPageIds must contain exactly this funnel's current pages." }, { status: 400 });
  }

  await Promise.all(orderedPageIds.map((id, index) => LmsPage.patch({ templateId, id }).set({ order: index }).go()));

  const { data: pages } = await LmsPage.query.byOrder({ templateId }).go({ pages: "all" });
  return NextResponse.json({ pages });
}
