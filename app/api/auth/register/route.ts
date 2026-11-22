import { PLAN, RETIRED_PLAN, PaidPlanId } from "@/lib/plan/plans";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { passwordProblem } from "@/lib/passwordPolicy";
import { hashPassword } from "@better-auth/utils/password";

import { EmailVerifyLink, User } from "@/lib/db/coreEntities";
import { createUserWithEmailLock, EmailAlreadyInUseError } from "@/lib/db/coreOperations";
import { normalizeCountryCode } from "@/lib/countries";
import { syncSignupToAlps } from "@/lib/alps";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildVerificationEmail } from "@/lib/mail/templates";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { logEmailDelivery } from "@/lib/mail/logEmail";

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
  const allowed = await checkCommerceRateLimit(`register:${clientIp(request)}`, 8, 60 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: { message: "Too many accounts created from this network recently. Please try again later." } }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : email.split("@")[0] || "Plexo User";
  // ULTRA: a signup page loaded before the plan rename (today's Pro).
  const pendingPlan: PaidPlanId | undefined =
    body.pendingPlan === RETIRED_PLAN.ULTRA ? PLAN.PRO : body.pendingPlan === PLAN.STARTER || body.pendingPlan === PLAN.PRO || body.pendingPlan === PLAN.ENTERPRISE ? body.pendingPlan : undefined;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: { message: "Enter a valid email address." } }, { status: 400 });
  }
  const country = normalizeCountryCode(body.country);
  if (!country) {
    return NextResponse.json({ error: { message: "Choose the country you're based in." } }, { status: 400 });
  }
  const problem = passwordProblem(password, email);
  if (problem) {
    return NextResponse.json({ error: { message: problem } }, { status: 400 });
  }

  const { data: existing } = await User.query.byEmail({ email }).go();
  if (existing.length > 0) {
    return NextResponse.json({ error: { message: "An account with this email already exists." } }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  try {
    await createUserWithEmailLock({ id, email, name, passwordHash, isConfirmed: false, pendingPlan, country, countrySetAt: new Date().toISOString(), signupSource: "plexo" });
  } catch (err) {
    if (err instanceof EmailAlreadyInUseError) {
      // Lost the race the pre-check above couldn't catch (two concurrent submissions for
      // the same email) — same response as the ordinary pre-check 409 above, just reached
      // via the transaction instead.
      return NextResponse.json({ error: { message: "An account with this email already exists." } }, { status: 409 });
    }
    throw err;
  }

  syncSignupToAlps({ id, email, name }, "email");

  // The link carries only this random token; the row maps it to the account (see EmailVerifyLink).
  const token = randomUUID();
  await EmailVerifyLink.create({
    token,
    userId: id,
    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString(),
  }).go();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const verifySubject = "Verify your Plexo account";
  try {
    await sendMaildripEmail({
      to: email,
      subject: verifySubject,
      html: buildVerificationEmail(`${baseUrl}/auth/confirm?token=${token}`),
    });
    logEmailDelivery({ kind: "maildrip", to: email, subject: verifySubject, status: "sent", context: "verification_email" });
  } catch (err) {
    // The account is real either way — a transient mail-provider error shouldn't fail
    // registration outright, same discipline as this migration's other non-fatal-email
    // patterns (e.g. site transfer offers).
    console.error("Failed to send verification email:", err);
    logEmailDelivery({
      kind: "maildrip",
      to: email,
      subject: verifySubject,
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "verification_email",
    });
  }

  return NextResponse.json({ data: { id, email } }, { status: 201 });
}
