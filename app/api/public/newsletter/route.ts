import { NextRequest, NextResponse } from "next/server";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { tagNewsletterSubscriber } from "@/lib/commerce/maildripNotify";

const PLATFORM_MAILDRIP_API_KEY = process.env.MAILDRIP_API_KEY;
const MARKETING_NEWSLETTER_GROUP_ID = process.env.MAILDRIP_MARKETING_GROUP_ID;

/**
 * Public, unauthenticated newsletter signup for Plexo's OWN marketing homepage (the
 * newsletter popup — app/components/v2/newsletter-popup.tsx) — entirely separate from
 * app/api/public/commerce/newsletter/route.ts, which tags a visitor into a TENANT site's
 * own configured MailDrip group. This always uses Plexo's shared platform key and a single
 * fixed group id, since there's exactly one "primary marketing mailing list," not one per
 * site. Reuses the same rate-limit key shape as the tenant route (checkCommerceRateLimit
 * isn't actually commerce-specific — it's a generic key+window limiter).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!PLATFORM_MAILDRIP_API_KEY || !MARKETING_NEWSLETTER_GROUP_ID) {
    return NextResponse.json({ error: "Newsletter signup isn't configured yet." }, { status: 503 });
  }

  const allowed = await checkCommerceRateLimit(`marketing-newsletter:${clientIp(request)}`, 5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — please try again shortly." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }

  try {
    await tagNewsletterSubscriber(PLATFORM_MAILDRIP_API_KEY, MARKETING_NEWSLETTER_GROUP_ID, email);
  } catch {
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
