import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { encryptMaildripKey } from "@/lib/crypto";
import { maildripRegister, maildripLogin, maildripVerify, maildripResendVerification, maildripFetchApiKey, isApiError } from "@/lib/maildripAuth";

/**
 * The "Connect MailDrip" flow behind form_container's 'maildrip' provider — an in-Plexo
 * login/create-account modal instead of sending the site owner off to app.maildrip.io. Every
 * step is a real call against MailDrip's own account API (server-to-server); this route never
 * fabricates success. One endpoint, dispatched by `action`, so the modal can stay a single
 * multi-step component talking to one place:
 *
 *   register -> verify_required (MailDrip emails a code)
 *   login    -> connected (already verified) | verify_required (never finished verifying)
 *   verify   -> MailDrip's own verify endpoint already returns a usable session token on
 *               success (confirmed against the real API — it exists specifically so a
 *               just-verified visitor can proceed without a second login), so this never
 *               needs the password resubmitted here.
 *   resend   -> re-sends the verification email
 *
 * "connected" always means: a real MailDrip API key was fetched and saved (encrypted) to this
 * site's CommerceSettings, ready for immediate use by "Create MailDrip Opt-in Page".
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  const auth = await resolveCommerceAdmin(request, templateId);
  if (auth.error) return auth.error;
  const { organizationId } = auth.context;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "email is required." }, { status: 400 });

  async function connectWithToken(token: string): Promise<NextResponse> {
    const keyResult = await maildripFetchApiKey(token);
    if (isApiError(keyResult)) {
      return NextResponse.json({ error: keyResult.error }, { status: 502 });
    }
    await prisma.commerceSettings.upsert({
      where: { templateId },
      create: { templateId, organizationId, maildripApiKeyEncrypted: encryptMaildripKey(keyResult.apiKey) },
      update: { maildripApiKeyEncrypted: encryptMaildripKey(keyResult.apiKey) },
    });
    return NextResponse.json({ status: "connected" });
  }

  if (action === "register") {
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!password || !name || !companyName || !phone) {
      return NextResponse.json({ error: "name, companyName, phone, and password are required." }, { status: 400 });
    }

    const result = await maildripRegister({ email, password, name, companyName, phone });
    if (isApiError(result)) return NextResponse.json({ error: result.error }, { status: result.status === 400 ? 400 : 502 });
    return NextResponse.json({ status: "verify_required", email });
  }

  if (action === "login") {
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return NextResponse.json({ error: "password is required." }, { status: 400 });

    const result = await maildripLogin({ email, password });
    if (isApiError(result)) return NextResponse.json({ error: result.error }, { status: result.status === 400 ? 400 : 502 });
    if (!result.verified) return NextResponse.json({ status: "verify_required", email });
    return connectWithToken(result.token);
  }

  if (action === "verify") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) return NextResponse.json({ error: "code is required." }, { status: 400 });

    const verifyResult = await maildripVerify({ email, verificationCode: code });
    if (isApiError(verifyResult)) return NextResponse.json({ error: verifyResult.error }, { status: verifyResult.status === 400 ? 400 : 502 });
    return connectWithToken(verifyResult.token);
  }

  if (action === "resend") {
    const result = await maildripResendVerification(email);
    if (isApiError(result)) return NextResponse.json({ error: result.error }, { status: result.status === 400 ? 400 : 502 });
    return NextResponse.json({ status: "sent" });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
