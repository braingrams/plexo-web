import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@better-auth/utils/password";

import { dynamoAdapter } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";

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
