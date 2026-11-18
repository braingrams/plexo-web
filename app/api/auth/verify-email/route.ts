import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { dynamoAdapter } from "@/server/authDynamo";
import { EmailVerifyLink, User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";

/**
 * GET /api/auth/verify-email?token=...
 *
 * app/auth/confirm/page.tsx redirects here with the random token from the emailed link
 * (see app/api/auth/register/route.ts). The token maps to the account through an
 * EmailVerifyLink row, so the email address is not needed in the URL.
 *
 * Links sent before that change carry `email` too. They still work through the legacy
 * branch below, which uses the email-keyed verification token. Remove that branch once
 * those links are gone (they expire after VERIFY_TOKEN_TTL_MS).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const legacyEmail = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const loginUrl = new URL("/auth/login", request.url);

  if (!token) {
    loginUrl.searchParams.set("verifyError", "This verification link is missing required information.");
    return NextResponse.redirect(loginUrl);
  }

  const allowed = await checkCommerceRateLimit(`verify-email:${createHash("sha256").update(token).digest("hex")}`, 10, 15 * 60_000);
  if (!allowed) {
    loginUrl.searchParams.set("verifyError", "Too many attempts. Please try again shortly.");
    return NextResponse.redirect(loginUrl);
  }

  const { data: link } = await EmailVerifyLink.get({ token }).go();
  if (link) {
    // Single use: remove the row first so the same link can't confirm twice.
    await EmailVerifyLink.delete({ token }).go();
    if (Date.parse(link.expiresAt) < Date.now()) {
      loginUrl.searchParams.set("verifyError", "This verification link is invalid or has expired.");
      return NextResponse.redirect(loginUrl);
    }
    const { data: user } = await User.get({ id: link.userId }).go();
    if (!user) {
      loginUrl.searchParams.set("verifyError", "Account not found.");
      return NextResponse.redirect(loginUrl);
    }
    await User.patch({ id: user.id }).set({ isConfirmed: true }).go();
    loginUrl.searchParams.set("verified", "1");
    return NextResponse.redirect(loginUrl);
  }

  // Legacy link from before EmailVerifyLink existed.
  if (!legacyEmail) {
    loginUrl.searchParams.set("verifyError", "This verification link is invalid or has expired.");
    return NextResponse.redirect(loginUrl);
  }
  const verification = await dynamoAdapter.useVerificationToken?.({ identifier: `verify-email:${legacyEmail}`, token });
  if (!verification || verification.expires < new Date()) {
    loginUrl.searchParams.set("verifyError", "This verification link is invalid or has expired.");
    return NextResponse.redirect(loginUrl);
  }
  const { data: matches } = await User.query.byEmail({ email: legacyEmail }).go();
  const user = matches[0];
  if (!user) {
    loginUrl.searchParams.set("verifyError", "Account not found.");
    return NextResponse.redirect(loginUrl);
  }
  await User.patch({ id: user.id }).set({ isConfirmed: true }).go();
  loginUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(loginUrl);
}
