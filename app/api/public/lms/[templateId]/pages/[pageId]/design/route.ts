import { NextRequest, NextResponse } from "next/server";
import { LmsPage, LmsPageProgress, Template } from "@/lib/db/contentEntities";
import { resolveLearner } from "@/lib/lms/learnerAuth";
import { evaluatePageUnlock, buildProgressMap } from "@/lib/lms/rules";

/**
 * GET /api/public/lms/[templateId]/pages/[pageId]/design
 *
 * Serves an ADVANCED-mode WELCOME page's linked design Template as a plain HTML document —
 * PortalClient.tsx embeds this via <iframe src="...">, not srcDoc, specifically so the
 * unlock check below re-runs on every load (an iframe with a cached srcDoc wouldn't). The
 * design Template's own compiledHtml is already sanitized by the ordinary
 * app/api/templates/update/[id] save pipeline (the same one every BUILDER page goes
 * through), so nothing extra is needed here beyond serving it.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; pageId: string }> },
): Promise<NextResponse> {
  const { templateId, pageId } = await context.params;
  const learner = await resolveLearner(request, templateId);
  if (!learner) return new NextResponse("Not signed in.", { status: 401 });

  const [{ data: page }, { data: progressRows }] = await Promise.all([
    LmsPage.get({ templateId, id: pageId }).go(),
    LmsPageProgress.query.primary({ templateId, email: learner.email }).go({ pages: "all" }),
  ]);
  if (!page || page.visible === false || page.contentMode !== "ADVANCED" || !page.designTemplateId) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const result = evaluatePageUnlock(page, { enrolledAt: learner.enrollment.enrolledAt ?? new Date().toISOString() }, buildProgressMap(progressRows));
  if (!result.unlocked) {
    return new NextResponse("This page isn't unlocked yet.", { status: 403 });
  }

  const { data: designTemplate } = await Template.get({ id: page.designTemplateId }).go();
  if (!designTemplate) return new NextResponse("Not found.", { status: 404 });

  return new NextResponse(designTemplate.compiledHtml || "<p>This page hasn't been designed yet.</p>", {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
