import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { dynamoAdapter } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildPasswordResetEmail } from "@/lib/mail/templates";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * POST /api/auth/forgot-password { email }
 * Replaces better-auth's forgetPassword. Always returns success regardless of whether the
 * account exists — app/auth/forgot-password/page.tsx already shows the same "if this email
 * exists" copy either way, so this doesn't leak account existence.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: { message: "Enter a valid email address." } }, { status: 400 });
  }

  const { data: matches } = await User.query.byEmail({ email }).go();
  const user = matches[0];

  if (user && user.passwordHash) {
    const token = randomUUID();
    await dynamoAdapter.createVerificationToken?.({
      identifier: `reset-password:${email}`,
      token,
      expires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const redirectTo = typeof body.redirectTo === "string" && body.redirectTo ? body.redirectTo : `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/reset-password`;
    const actionUrl = `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}token=${token}&email=${encodeURIComponent(email)}`;

    try {
      await sendMaildripEmail({
        to: email,
        subject: "Reset your Plexo password",
        html: buildPasswordResetEmail(actionUrl),
      });
    } catch (err) {
      console.error("Failed to send password reset email:", err);
    }
  }

  return NextResponse.json({ data: { ok: true } });
}
