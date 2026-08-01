import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { isValidUuid } from "@/server/slug";

/**
 * POST /api/templates/:id/eject
 *
 * Switches a BUILDER page to RAW_UPLOAD in place — a non-destructive flag flip, not a
 * re-upload: compiledHtml already holds this page's fully compiled output, so there's
 * nothing to regenerate. From this point on the page is edited as text (via the raw-file
 * editor) instead of the visual builder; designJson is left untouched but ignored going
 * forward (BUILDER-mode edits would no longer reach the served page).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const existing = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { id: true, sourceType: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (existing.sourceType === "RAW_UPLOAD") {
    return NextResponse.json({ error: "This page is already raw HTML." }, { status: 400 });
  }

  const updated = await prisma.template.update({
    where: { id: existing.id },
    data: { sourceType: "RAW_UPLOAD" },
    select: { id: true, sourceType: true },
  });

  return NextResponse.json({ page: updated });
}
