import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsEnrollment, LmsPage, LmsPageProgress } from "@/lib/db/contentEntities";

// The one interactive control the enrollments view needs for MANUAL_APPROVAL-gated pages —
// reversible, no confirmation dialog needed (see the Funnel/LMS plan's admin-UX section).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; email: string }> },
): Promise<NextResponse> {
  const { templateId, email } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role, userId } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { pageId?: string };
  const pageId = body.pageId?.trim();
  if (!pageId) return NextResponse.json({ error: "pageId is required." }, { status: 400 });

  const decodedEmail = decodeURIComponent(email);
  const [{ data: enrollment }, { data: page }] = await Promise.all([
    LmsEnrollment.get({ templateId, email: decodedEmail }).go(),
    LmsPage.get({ templateId, id: pageId }).go(),
  ]);
  if (!enrollment) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  await LmsPageProgress.upsert({
    templateId,
    email: decodedEmail,
    pageId,
    adminApprovedAt: new Date().toISOString(),
    adminApprovedByUserId: userId,
  }).go();

  const { data: progress } = await LmsPageProgress.get({ templateId, email: decodedEmail, pageId }).go();
  return NextResponse.json({ progress });
}
