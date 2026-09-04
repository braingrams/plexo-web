import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@better-auth/utils/password";

import { dynamoAdapter } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";

/**
 * POST /api/auth/reset-password { token, email, newPassword }
 * Replaces better-auth's resetPassword.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!token || !email) {
    return NextResponse.json({ error: { message: "Missing or invalid reset link." } }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: { message: "Password must be at least 8 characters." } }, { status: 400 });
  }

  // Tokens are cryptographically random (randomUUID) so brute-forcing one directly isn't
  // realistic, but this still caps automated retry volume against a single email as
  // defense-in-depth, same as every other auth route here.
  const allowed = await checkCommerceRateLimit(`reset-password:${email}`, 10, 15 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: { message: "Too many attempts. Please try again shortly." } }, { status: 429 });
  }

  const verification = await dynamoAdapter.useVerificationToken?.({ identifier: `reset-password:${email}`, token });
  if (!verification || verification.expires < new Date()) {
    return NextResponse.json({ error: { message: "This reset link is invalid or has expired." } }, { status: 400 });
  }

  const { data: matches } = await User.query.byEmail({ email }).go();
  const user = matches[0];
  if (!user) {
    return NextResponse.json({ error: { message: "Account not found." } }, { status: 404 });
  }

  const passwordHash = await hashPassword(newPassword);
  await User.patch({ id: user.id }).set({ passwordHash }).go();

  return NextResponse.json({ data: { ok: true } });
}
