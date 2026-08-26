import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { decryptMaildripKey } from "@/lib/crypto";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";
import { tagNewsletterSubscriber } from "@/lib/commerce/maildripNotify";

const PLATFORM_MAILDRIP_API_KEY = process.env.MAILDRIP_API_KEY;

/** Public, unauthenticated newsletter signup — a site visitor tagging themselves into the
 * site's configured MailDrip newsletter group, entirely separate from the paid-customer
 * tagging the Paystack webhook does (see CommerceSettings.maildripNewsletterGroupId). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const allowed = await checkCommerceRateLimit(`commerce:newsletter:${templateId}:${clientIp(request)}`, 5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — please try again shortly." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  if (!settings?.maildripNewsletterGroupId) {
    return NextResponse.json({ error: "Newsletter isn't set up for this site yet." }, { status: 400 });
  }
  const apiKey = settings.maildripApiKeyEncrypted ? decryptMaildripKey(settings.maildripApiKeyEncrypted) : PLATFORM_MAILDRIP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Newsletter isn't set up for this site yet." }, { status: 400 });
  }

  try {
    await tagNewsletterSubscriber(apiKey, settings.maildripNewsletterGroupId, email);
  } catch {
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
