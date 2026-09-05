import { NextRequest, NextResponse } from "next/server";
import { dynamoAdapter } from "@/server/authDynamo";
import { LmsEnrollment } from "@/lib/db/contentEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { lmsSessionCookieName, signLmsSession, LMS_SESSION_MAX_AGE_SECONDS } from "@/lib/lms/session";

/**
 * GET /api/public/lms/[templateId]/magic-link/verify?token=...&email=...
 *
 * Redeems the single-use token (Auth.js's useVerificationToken — same primitive
 * app/api/auth/verify-email/route.ts uses, different identifier namespace) and, unlike
 * that route, establishes an ongoing session rather than just flipping a flag: mints the
 * learner's signed session cookie and sends them into the portal. From here on, a
 * returning visitor with a valid cookie skips this route entirely.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const errorUrl = new URL(`/learn/${templateId}`, appUrl);

  if (!token || !email) {
    errorUrl.searchParams.set("error", "This link is missing required information.");
    return NextResponse.redirect(errorUrl);
  }

  const allowed = await checkCommerceRateLimit(`lms:verify:${templateId}:${email}`, 10, 15 * 60_000);
  if (!allowed) {
    errorUrl.searchParams.set("error", "Too many attempts. Please try again shortly.");
    return NextResponse.redirect(errorUrl);
  }

  const verification = await dynamoAdapter.useVerificationToken?.({ identifier: `lms-login:${templateId}:${email}`, token });
  if (!verification || verification.expires < new Date()) {
    errorUrl.searchParams.set("error", "This link is invalid or has expired.");
    return NextResponse.redirect(errorUrl);
  }

  const { data: enrollment } = await LmsEnrollment.get({ templateId, email }).go();
  if (!enrollment || enrollment.status !== "ACTIVE") {
    errorUrl.searchParams.set("error", "This enrollment is no longer active.");
    return NextResponse.redirect(errorUrl);
  }

  await LmsEnrollment.patch({ templateId, email }).set({ lastActiveAt: new Date().toISOString() }).go();

  const sessionToken = await signLmsSession({ templateId, email });
  const response = NextResponse.redirect(new URL(`/learn/${templateId}?welcome=1`, appUrl));
  response.cookies.set(lmsSessionCookieName(templateId), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: LMS_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
