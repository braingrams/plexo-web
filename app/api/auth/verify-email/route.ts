import { NextRequest, NextResponse } from "next/server";

import { dynamoAdapter } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";

/**
 * GET /api/auth/verify-email?token=...&email=...
 *
 * app/auth/confirm/page.tsx redirects here with the token + email from the emailed link
 * (see app/api/auth/register/route.ts). Replaces better-auth's built-in verify-email
 * endpoint, which no longer exists once the login handler moved off better-auth's
 * catch-all route. useVerificationToken is keyed by {identifier, token} — email is
 * required up front to reconstruct the same `verify-email:<email>` identifier the
 * registration route stored it under, since the token alone carries no lookup index.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const loginUrl = new URL("/auth/login", request.url);

  if (!token || !email) {
    loginUrl.searchParams.set("verifyError", "This verification link is missing required information.");
    return NextResponse.redirect(loginUrl);
  }

  const allowed = await checkCommerceRateLimit(`verify-email:${email}`, 10, 15 * 60_000);
  if (!allowed) {
    loginUrl.searchParams.set("verifyError", "Too many attempts. Please try again shortly.");
    return NextResponse.redirect(loginUrl);
  }

  const verification = await dynamoAdapter.useVerificationToken?.({ identifier: `verify-email:${email}`, token });
  if (!verification || verification.expires < new Date()) {
    loginUrl.searchParams.set("verifyError", "This verification link is invalid or has expired.");
    return NextResponse.redirect(loginUrl);
  }

  const { data: matches } = await User.query.byEmail({ email }).go();
  const user = matches[0];
  if (!user) {
    loginUrl.searchParams.set("verifyError", "Account not found.");
    return NextResponse.redirect(loginUrl);
  }

  await User.patch({ id: user.id }).set({ isConfirmed: true }).go();

  loginUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(loginUrl);
}
