import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import { extractTextNodes, applyTextEdits, annotateTextNodesForPreview } from "@/lib/htmlTextExtraction";
import {
  extractImageNodes,
  annotateImageNodesForPreview,
  applyImageEdits,
  type ImgEdit,
  type BackgroundEdit,
} from "@/lib/htmlImageExtraction";
import { extractColorNodes, annotateColorNodesForPreview, applyColorEdits, type ColorEdit } from "@/lib/htmlColorExtraction";
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
  const imageNodes = extractImageNodes(template.compiledHtml);
  const colorNodes = extractColorNodes(template.compiledHtml);
  // Compose color + text + image annotation into one preview doc. Color goes first and
  // against the pristine html specifically: annotateColorNodesForPreview re-derives ids by
  // calling extractColorNodes on whatever html it's given, and that MUST be the same html
  // colorNodes above was computed from for the ids to line up — running it after the other
  // two passes would still happen to work today (neither touches style attributes/blocks in
  // a way that shifts color ordering), but doing color first removes the need to rely on
  // that. Text/image annotation are unaffected by data-pcolor attributes already being
  // present, since their own walks key off text nodes / img tags, not this attribute.
  const previewHtml = annotateImageNodesForPreview(
    annotateTextNodesForPreview(annotateColorNodesForPreview(template.compiledHtml)),
  );
  return NextResponse.json({ nodes, imageNodes, colorNodes, previewHtml });
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

  const body = (await request.json().catch(() => null)) as {
    edits?: { id?: number; text?: string; href?: string }[];
    imgEdits?: { id?: number; src?: string; width?: number | null; height?: number | null }[];
    backgroundEdits?: { id?: number; src?: string; backgroundSize?: string | null }[];
    colorEdits?: { id?: number; value?: string }[];
  } | null;
  const rawEdits = Array.isArray(body?.edits) ? body.edits : [];
  const rawImgEdits = Array.isArray(body?.imgEdits) ? body.imgEdits : [];
  const rawBackgroundEdits = Array.isArray(body?.backgroundEdits) ? body.backgroundEdits : [];
  const rawColorEdits = Array.isArray(body?.colorEdits) ? body.colorEdits : [];
  if (rawEdits.length === 0 && rawImgEdits.length === 0 && rawBackgroundEdits.length === 0 && rawColorEdits.length === 0) {
    return NextResponse.json({ error: "No edits provided." }, { status: 400 });
  }
  const edits = rawEdits
    .filter((e): e is { id: number; text: string; href?: string } => typeof e.id === "number" && typeof e.text === "string")
    .map((e) => ({ id: e.id, text: e.text, ...(typeof e.href === "string" ? { href: e.href } : {}) }));
  const imgEdits: ImgEdit[] = rawImgEdits
    .filter((e): e is { id: number; src?: string; width?: number | null; height?: number | null } => typeof e.id === "number")
    .map((e) => ({ id: e.id, src: e.src, width: e.width, height: e.height }));
  const backgroundEdits: BackgroundEdit[] = rawBackgroundEdits
    .filter((e): e is { id: number; src?: string; backgroundSize?: string | null } => typeof e.id === "number")
    .map((e) => ({ id: e.id, src: e.src, backgroundSize: e.backgroundSize }));
  const colorEdits: ColorEdit[] = rawColorEdits
    .filter((e): e is { id: number; value: string } => typeof e.id === "number" && typeof e.value === "string")
    .map((e) => ({ id: e.id, value: e.value }));

  let updatedHtml = applyTextEdits(template.compiledHtml, edits);
  updatedHtml = applyImageEdits(updatedHtml, imgEdits, backgroundEdits);
  updatedHtml = applyColorEdits(updatedHtml, colorEdits);
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
