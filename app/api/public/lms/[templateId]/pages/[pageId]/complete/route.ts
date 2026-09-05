import { NextRequest, NextResponse } from "next/server";
import { LmsPage, LmsPageProgress, LmsEnrollment } from "@/lib/db/contentEntities";
import { resolveLearner } from "@/lib/lms/learnerAuth";
import { evaluatePageUnlock, buildProgressMap } from "@/lib/lms/rules";

// Marks a page complete for this learner and bumps the denormalized
// LmsEnrollment.completedPageCount (kept accurate here, the one place completion happens,
// rather than recomputed from a query on every enrollment-list render).
export async function POST(
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
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  const result = evaluatePageUnlock(page, { enrolledAt: learner.enrollment.enrolledAt ?? new Date().toISOString() }, buildProgressMap(progressRows));
  if (!result.unlocked) {
    return NextResponse.json({ error: "This page isn't unlocked yet." }, { status: 403 });
  }

  const existing = progressRows.find((p) => p.pageId === pageId);
  const now = new Date().toISOString();
  const alreadyCompleted = Boolean(existing?.completedAt);

  await LmsPageProgress.upsert({ templateId, email: learner.email, pageId, completedAt: now }).go();

  if (!alreadyCompleted) {
    const newCount = (learner.enrollment.completedPageCount ?? 0) + 1;
    const isWholeFunnelComplete = newCount >= (await LmsPage.query.byOrder({ templateId }).go({ pages: "all" })).data.filter((p) => p.visible !== false).length;
    await LmsEnrollment.patch({ templateId, email: learner.email })
      .set({
        completedPageCount: newCount,
        lastCompletedAt: now,
        lastActiveAt: now,
        ...(isWholeFunnelComplete ? { completedAt: now } : {}),
      })
      .go();
  }

  return NextResponse.json({ success: true });
}
