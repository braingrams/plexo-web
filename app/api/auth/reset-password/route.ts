import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@better-auth/utils/password";

import { dynamoAdapter } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { passwordProblem } from "@/lib/passwordPolicy";
import { confirmReset } from "@/server/charisolCognito";

/**
 * POST /api/auth/reset-password
 *   { token, email, newPassword } — Plexo's emailed reset link (password held by Plexo)
 *   { code, email, newPassword }  — Charisol's emailed 6-digit code (password held by Charisol)
 * Replaces better-auth's resetPassword.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if ((!token && !code) || !email) {
    return NextResponse.json({ error: { message: "This reset link is incomplete. Request a new one from the Forgot password page." } }, { status: 400 });
  }
  const problem = passwordProblem(newPassword, email);
  if (problem) {
    return NextResponse.json({ error: { message: problem } }, { status: 400 });
  }

  const allowed = await checkCommerceRateLimit(`reset-password:${email}`, 10, 15 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: { message: "Too many attempts. Please try again shortly." } }, { status: 429 });
  }

  if (code) return resetWithCharisolCode(email, code, newPassword);

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

const CODE_ERRORS: Record<string, { message: string; status: number }> = {
  invalid_code: { message: "That code isn't right. Check the most recent email from us, or send a new code.", status: 400 },
  expired_code: { message: "That code has expired. Send a new code and try again.", status: 400 },
  rate_limited: { message: "Too many attempts. Please wait a few minutes and try again.", status: 429 },
  unavailable: { message: "Password reset is temporarily unavailable. Please try again in a few minutes.", status: 503 },
};

async function resetWithCharisolCode(email: string, code: string, newPassword: string): Promise<NextResponse> {
  const result = await confirmReset(email, code, newPassword);
  if (result.kind === "weak_password") {
    return NextResponse.json({ error: { message: result.message || "That password doesn't meet the password rules." } }, { status: 400 });
  }
  if (result.kind !== "ok") {
    const { message, status } = CODE_ERRORS[result.kind];
    return NextResponse.json({ error: { message } }, { status });
  }
  // Charisol now holds this person's password — stop accepting the old local one.
  const { data: matches } = await User.query.byEmail({ email }).go();
  if (matches[0] && !matches[0].charisolPasswordAt) {
    await User.patch({ id: matches[0].id }).set({ charisolPasswordAt: new Date().toISOString() }).go();
  }
  return NextResponse.json({ data: { ok: true } });
}
