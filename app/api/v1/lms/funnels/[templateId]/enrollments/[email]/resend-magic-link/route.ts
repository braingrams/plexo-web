import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";
import { LmsEnrollment } from "@/lib/db/contentEntities";
import { sendMagicLinkEmail } from "@/lib/lms/enrollment";

const RESEND_COOLDOWN_MS = 60_000;

// The admin's "reach out" resend action — distinct from the mailto link in the
// enrollments list, this actually re-triggers the passwordless login email for a learner
// who says they never got (or lost) theirs.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; email: string }> },
): Promise<NextResponse> {
  const { templateId, email } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const decodedEmail = decodeURIComponent(email);
  const { data: enrollment } = await LmsEnrollment.get({ templateId, email: decodedEmail }).go();
  if (!enrollment) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  if (enrollment.status !== "ACTIVE") {
    return NextResponse.json({ error: "This enrollment is revoked — reactivate it first." }, { status: 400 });
  }
  if (enrollment.magicLinkLastSentAt && Date.now() - new Date(enrollment.magicLinkLastSentAt).getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json({ error: "A link was just sent — wait a moment before resending." }, { status: 429 });
  }

  try {
    await sendMagicLinkEmail(templateId, decodedEmail);
  } catch {
    return NextResponse.json({ error: "Could not send the link — please try again." }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
