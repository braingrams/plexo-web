import { NextRequest, NextResponse } from "next/server";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsEnrollment } from "@/lib/db/contentEntities";

// Newest-first learner list for the funnel admin's Enrollments view. Per-page progress
// detail is fetched separately (LmsEnrollment.completedPageCount is denormalized so this
// list never fans out into an LmsPageProgress query per row).
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: enrollments } = await LmsEnrollment.query.byEnrolledAt({ templateId }).go({ pages: "all" });
  enrollments.sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""));

  return NextResponse.json({ enrollments });
}
