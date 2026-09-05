import { NextRequest, NextResponse } from "next/server";
import { LmsEnrollment } from "@/lib/db/contentEntities";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { sendMagicLinkEmail } from "@/lib/lms/enrollment";

// Returning-visitor path: their session cookie expired/was cleared, so they ask for a
// fresh link instead of re-doing signup. Always responds success regardless of whether the
// email is actually enrolled, to avoid leaking enrollment existence to an unauthenticated caller.
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;

  const allowed = await checkCommerceRateLimit(`lms:magic-link:${templateId}:${clientIp(request)}`, 5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — please try again shortly." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const { data: enrollment } = await LmsEnrollment.get({ templateId, email }).go();
  if (enrollment && enrollment.status === "ACTIVE") {
    await sendMagicLinkEmail(templateId, email).catch((err) => console.error("Failed to resend LMS magic link:", err));
  }

  return NextResponse.json({ success: true });
}
