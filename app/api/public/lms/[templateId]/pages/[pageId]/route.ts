import { NextRequest, NextResponse } from "next/server";
import { LmsPage, LmsPageProgress } from "@/lib/db/contentEntities";
import { resolveLearner } from "@/lib/lms/learnerAuth";
import { evaluatePageUnlock, buildProgressMap } from "@/lib/lms/rules";
import { getSignedDownloadUrl } from "@/lib/storage";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";

// Session-gated content fetch — re-checks the unlock rule server-side even though the
// portal's own UI already hides locked pages, since a learner could otherwise just guess a
// pageId. Documents/images are never served from their permanent private URL: a fresh
// 5-minute signed URL is minted per view, same pattern as Commerce's digital-delivery route.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; pageId: string }> },
): Promise<NextResponse> {
  const { templateId, pageId } = await context.params;
  const learner = await resolveLearner(request, templateId);
  if (!learner) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: page }, { data: progressRows }] = await Promise.all([
    LmsPage.get({ templateId, id: pageId }).go(),
    LmsPageProgress.query.primary({ templateId, email: learner.email }).go({ pages: "all" }),
  ]);
  if (!page || page.visible === false) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  const result = evaluatePageUnlock(page, { enrolledAt: learner.enrollment.enrolledAt ?? new Date().toISOString() }, buildProgressMap(progressRows));
  if (!result.unlocked) {
    return NextResponse.json({ error: "This page isn't unlocked yet.", blockedBy: result.blockedBy }, { status: 403 });
  }

  const existingProgress = progressRows.find((p) => p.pageId === pageId);
  if (!existingProgress) {
    await LmsPageProgress.create({ templateId, email: learner.email, pageId, firstViewedAt: new Date().toISOString() }).go().catch(() => {});
  }

  let signedAssetUrl: string | null = null;
  if ((page.kind === "DOCUMENT" || page.kind === "IMAGE") && page.assetUrl) {
    signedAssetUrl = await getSignedDownloadUrl(page.assetUrl, 5 * 60);
  }

  // SIMPLE/RAW_HTML both render as real HTML in the learner portal (unlike a RAW_UPLOAD
  // Template, this renders on Plexo's own domain alongside a real learner session cookie,
  // so it must be sanitized here regardless of which editor UI wrote it — see
  // contentEntities.ts's own comment on LmsPage.contentMode). ADVANCED's content lives in a
  // separate Template instead, embedded via iframe from its own dedicated route — that
  // Template's compiledHtml is already sanitized by the ordinary save pipeline.
  const contentMode = page.contentMode ?? "SIMPLE";
  const bodyHtml = page.kind === "WELCOME" && contentMode !== "ADVANCED" && page.bodyHtml ? sanitizeBlogHtml(page.bodyHtml) : null;

  return NextResponse.json({
    id: page.id,
    kind: page.kind,
    title: page.title,
    contentMode,
    bodyHtml,
    designTemplateId: contentMode === "ADVANCED" ? page.designTemplateId ?? null : null,
    youtubeVideoId: page.youtubeVideoId ?? null,
    assetUrl: signedAssetUrl,
    assetFileName: page.assetFileName ?? null,
  });
}
