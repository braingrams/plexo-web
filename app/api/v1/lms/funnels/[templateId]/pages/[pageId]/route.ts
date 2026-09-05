import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsPage } from "@/lib/db/contentEntities";
import type { LmsPageUnlockRules } from "@/lib/lms/rules";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; pageId: string }> },
): Promise<NextResponse> {
  const { templateId, pageId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: page } = await LmsPage.get({ templateId, id: pageId }).go();
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  return NextResponse.json({ page });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; pageId: string }> },
): Promise<NextResponse> {
  const { templateId, pageId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await LmsPage.get({ templateId, id: pageId }).go();
  if (!existing) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    kind?: "WELCOME" | "VIDEO" | "DOCUMENT" | "IMAGE";
    contentMode?: "SIMPLE" | "RAW_HTML" | "ADVANCED";
    bodyHtml?: string;
    youtubeVideoId?: string | null;
    assetUrl?: string | null;
    assetFileName?: string | null;
    assetMimeType?: string | null;
    assetSizeBytes?: number | null;
    unlockRules?: LmsPageUnlockRules;
    visible?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (body.kind) patch.kind = body.kind;
  if (body.contentMode) patch.contentMode = body.contentMode;
  if (body.bodyHtml !== undefined) patch.bodyHtml = body.bodyHtml;
  if (body.youtubeVideoId !== undefined) patch.youtubeVideoId = body.youtubeVideoId ?? undefined;
  if (body.assetUrl !== undefined) patch.assetUrl = body.assetUrl ?? undefined;
  if (body.assetFileName !== undefined) patch.assetFileName = body.assetFileName ?? undefined;
  if (body.assetMimeType !== undefined) patch.assetMimeType = body.assetMimeType ?? undefined;
  if (body.assetSizeBytes !== undefined) patch.assetSizeBytes = body.assetSizeBytes ?? undefined;
  if (body.unlockRules) patch.unlockRules = body.unlockRules;
  if (typeof body.visible === "boolean") patch.visible = body.visible;

  if (Object.keys(patch).length > 0) {
    await LmsPage.patch({ templateId, id: pageId }).set(patch).go();
  }

  const { data: page } = await LmsPage.get({ templateId, id: pageId }).go();
  return NextResponse.json({ page });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; pageId: string }> },
): Promise<NextResponse> {
  const { templateId, pageId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["delete"] });
  if (permissionError) return permissionError;

  await LmsPage.delete({ templateId, id: pageId }).go();

  // Close the order gap so byOrder stays contiguous — simplest correct approach for the
  // expected page counts here (tens, not thousands); re-fetches and re-patches in one pass.
  const { data: remaining } = await LmsPage.query.byOrder({ templateId }).go({ pages: "all" });
  await Promise.all(
    remaining.map((page, index) => (page.order === index ? Promise.resolve() : LmsPage.patch({ templateId, id: page.id }).set({ order: index }).go())),
  );

  return NextResponse.json({ success: true });
}
