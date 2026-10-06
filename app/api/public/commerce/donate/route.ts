import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { DonationError, startDonation } from "@/lib/commerce/donations";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST — start a donation from a donate form on a published site.
 * Body: { campaignId, amountMinor, frequency: "ONCE" | "MONTHLY", donorEmail, donorName?, paymentMethod?, returnPath? }
 * Responds with the same shapes the storefront checkout does (embedded Stripe checkout,
 * a Paystack redirect, or bank-transfer instructions), so public/commerce.js finishes it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const site = await resolveSite(hostname);
  if (site.status !== "ok") return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const templateId = site.published.templateId;

  if (!(await checkCommerceRateLimit(`commerce:donate:${templateId}:${clientIp(request)}`, 10))) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const donorEmail = typeof body.donorEmail === "string" ? body.donorEmail.trim() : "";
  if (!isValidEmail(donorEmail)) return NextResponse.json({ error: "Please enter a valid email address for your receipt." }, { status: 400 });
  if (typeof body.campaignId !== "string") return NextResponse.json({ error: "This donation form is missing its campaign." }, { status: 400 });
  const amountMinor = Number(body.amountMinor);
  const returnPath = typeof body.returnPath === "string" && body.returnPath.startsWith("/") && !body.returnPath.startsWith("//") ? body.returnPath : "/";

  try {
    const result = await startDonation({
      templateId,
      organizationId: site.published.organization.id,
      campaignId: body.campaignId,
      amountMinor: Number.isFinite(amountMinor) ? Math.round(amountMinor) : 0,
      frequency: body.frequency === "MONTHLY" ? "MONTHLY" : "ONCE",
      donorEmail,
      donorName: typeof body.donorName === "string" && body.donorName.trim() ? body.donorName.trim().slice(0, 120) : null,
      paymentMethod: body.paymentMethod === "BANK_TRANSFER" ? "BANK_TRANSFER" : body.paymentMethod === "ONLINE" ? "ONLINE" : undefined,
      returnUrl: new URL(returnPath, request.nextUrl.origin).toString(),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DonationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
