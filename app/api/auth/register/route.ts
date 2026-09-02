import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@better-auth/utils/password";

import { dynamoAdapter } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildVerificationEmail } from "@/lib/mail/templates";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/auth/register
 *
 * Replaces better-auth's signUp.email — creates the User row directly (Credentials
 * providers have no adapter-driven signup of their own, unlike OAuth) with a hashed
 * password and isConfirmed:false, then emails a verification link. Deliberately does NOT
 * sign the caller in afterward: requireEmailVerification was the original policy (see
 * server/auth.ts's emailAndPassword config), and app/auth/register/page.tsx already
 * expects this to redirect to /auth/confirm rather than land in the dashboard.
 *
 * Org creation is NOT done here — server/orgDynamo.ts's ensureActiveOrganization already
 * lazily creates a "My Workspace" org for any signed-in user with zero memberships, the
 * first time they reach the dashboard, same as it always has for Google sign-ins.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : email.split("@")[0] || "Plexo User";
  const pendingPlan = body.pendingPlan === "PRO" || body.pendingPlan === "ULTRA" ? body.pendingPlan : null;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: { message: "Enter a valid email address." } }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: { message: "Password must be at least 8 characters." } }, { status: 400 });
  }

  const { data: existing } = await User.query.byEmail({ email }).go();
  if (existing.length > 0) {
    return NextResponse.json({ error: { message: "An account with this email already exists." } }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  await User.create({ id, email, name, passwordHash, isConfirmed: false, pendingPlan }).go();

  const token = randomUUID();
  await dynamoAdapter.createVerificationToken?.({
    identifier: `verify-email:${email}`,
    token,
    expires: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    await sendMaildripEmail({
      to: email,
      subject: "Verify your Plexo account",
      html: buildVerificationEmail(`${baseUrl}/auth/confirm?token=${token}&email=${encodeURIComponent(email)}`),
    });
  } catch (err) {
    // The account is real either way — a transient mail-provider error shouldn't fail
    // registration outright, same discipline as this migration's other non-fatal-email
    // patterns (e.g. site transfer offers).
    console.error("Failed to send verification email:", err);
  }

  return NextResponse.json({ data: { id, email } }, { status: 201 });
}
