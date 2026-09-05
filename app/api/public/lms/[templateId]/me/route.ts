import { NextRequest, NextResponse } from "next/server";
import { LmsPage, LmsPageProgress } from "@/lib/db/contentEntities";
import { resolveLearner } from "@/lib/lms/learnerAuth";
import { evaluatePageUnlock, buildProgressMap } from "@/lib/lms/rules";

// The learner portal's one big read: every visible page, each with its computed unlock
// state, in a single response — the rule engine (lib/lms/rules.ts) is pure, so this is one
// pages query + one progress query, evaluated in memory, no per-page round trip.
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const learner = await resolveLearner(request, templateId);
  if (!learner) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: pages }, { data: progressRows }] = await Promise.all([
    LmsPage.query.byOrder({ templateId }).go({ pages: "all" }),
    LmsPageProgress.query.primary({ templateId, email: learner.email }).go({ pages: "all" }),
  ]);

  const progressByPageId = buildProgressMap(progressRows);
  const visiblePages = pages.filter((p) => p.visible !== false);

  const items = visiblePages.map((page) => {
    const result = evaluatePageUnlock(page, { enrolledAt: learner.enrollment.enrolledAt ?? new Date().toISOString() }, progressByPageId);
    const progress = progressByPageId.get(page.id);
    return {
      id: page.id,
      order: page.order,
      kind: page.kind,
      title: page.title,
      unlocked: result.unlocked,
      completed: Boolean(progress?.completedAt),
      awaitingApproval: result.blockedBy.some((c) => c.type === "MANUAL_APPROVAL"),
    };
  });

  return NextResponse.json({
    email: learner.email,
    name: learner.enrollment.name ?? null,
    completedPageCount: learner.enrollment.completedPageCount ?? 0,
    pages: items,
  });
}
