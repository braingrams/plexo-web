import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { extractTextNodes, applyTextEdits, annotateTextNodesForPreview } from "@/lib/htmlTextExtraction";
import { scanPublishedDomain } from "@/lib/safeBrowsing";

/**
 * GET /api/v1/templates/:id/text-content
 *
 * Extracts every visible text node from a RAW_UPLOAD template's index.html — paragraphs,
 * headings, menu items, button labels, etc. — for the "Text Content" editing mode, so a
 * non-technical user can rewrite copy without touching markup. See lib/htmlTextExtraction.ts.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { sourceType: true, compiledHtml: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const nodes = extractTextNodes(template.compiledHtml);
  const previewHtml = annotateTextNodesForPreview(template.compiledHtml);
  return NextResponse.json({ nodes, previewHtml });
}

/**
 * PATCH /api/v1/templates/:id/text-content
 *
 * Applies a batch of text-node edits (from the same GET's node ids) back into index.html.
 * Unsanitized, same as every other RAW_UPLOAD write path — see files/[...path]/route.ts's
 * identical doc comment for why.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    select: { id: true, sourceType: true, compiledHtml: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { edits?: { id?: number; text?: string }[] } | null;
  const rawEdits = Array.isArray(body?.edits) ? body.edits : null;
  if (!rawEdits) {
    return NextResponse.json({ error: "Missing required 'edits' array." }, { status: 400 });
  }
  const edits = rawEdits
    .filter((e): e is { id: number; text: string } => typeof e.id === "number" && typeof e.text === "string")
    .map((e) => ({ id: e.id, text: e.text }));

  const updatedHtml = applyTextEdits(template.compiledHtml, edits);
  await prisma.template.update({
    where: { id: template.id },
    data: { compiledHtml: updatedHtml },
  });

  // Content changed — re-scan every domain it's currently live on, same as files/[...path].
  const linkedDomains = await prisma.publishedDomain.findMany({
    where: { templateId: template.id },
    select: { id: true },
  });
  for (const d of linkedDomains) {
    void scanPublishedDomain(d.id).catch((err) => console.error("Safe Browsing scan failed:", err));
  }

  return NextResponse.json({ success: true });
}
