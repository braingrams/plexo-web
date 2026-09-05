import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsEnrollment, LmsPageProgress } from "@/lib/db/contentEntities";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; email: string }> },
): Promise<NextResponse> {
  const { templateId, email } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const decodedEmail = decodeURIComponent(email);
  const [{ data: enrollment }, { data: progress }] = await Promise.all([
    LmsEnrollment.get({ templateId, email: decodedEmail }).go(),
    // Partial sort-key match on the primary index (email is a prefix of the pageId-suffixed
    // sk) — begins_with under the hood, one round trip for this learner's whole progress.
    LmsPageProgress.query.primary({ templateId, email: decodedEmail }).go({ pages: "all" }),
  ]);
  if (!enrollment) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });

  return NextResponse.json({ enrollment, progress });
}

// Revoke/reactivate — the admin's "kick this learner out" control (the learner-session
// design checks LmsEnrollment.status on every protected request, so this takes effect
// immediately on their next page load, no separate session table to invalidate).
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; email: string }> },
): Promise<NextResponse> {
  const { templateId, email } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role, userId } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { status?: "ACTIVE" | "REVOKED" };
  if (body.status !== "ACTIVE" && body.status !== "REVOKED") {
    return NextResponse.json({ error: "status must be ACTIVE or REVOKED." }, { status: 400 });
  }

  const decodedEmail = decodeURIComponent(email);
  const { data: existing } = await LmsEnrollment.get({ templateId, email: decodedEmail }).go();
  if (!existing) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });

  await LmsEnrollment.patch({ templateId, email: decodedEmail })
    .set(
      body.status === "REVOKED"
        ? { status: "REVOKED", revokedAt: new Date().toISOString(), revokedByUserId: userId }
        : { status: "ACTIVE" },
    )
    .go();

  const { data: enrollment } = await LmsEnrollment.get({ templateId, email: decodedEmail }).go();
  return NextResponse.json({ enrollment });
}
