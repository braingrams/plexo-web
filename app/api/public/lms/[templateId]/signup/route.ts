import { NextRequest, NextResponse } from "next/server";
import { Template, LmsFunnel } from "@/lib/db/contentEntities";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { createFreeEnrollment } from "@/lib/lms/enrollment";

/**
 * POST /api/public/lms/[templateId]/signup
 *
 * Free funnels only for now — a PAID funnel's signup should route through Commerce's
 * checkout for its linked signup product instead (see the Funnel/LMS plan's billing
 * section: enrollment activates from the Commerce order-paid webhook, not from here).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;

  const allowed = await checkCommerceRateLimit(`lms:signup:${templateId}:${clientIp(request)}`, 5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — please try again shortly." }, { status: 429 });
  }

  const [{ data: site }, { data: funnel }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    LmsFunnel.get({ templateId }).go(),
  ]);
  if (!site || !funnel || !funnel.enabled) {
    return NextResponse.json({ error: "This funnel isn't available." }, { status: 404 });
  }
  if (funnel.signupMode === "PAID") {
    return NextResponse.json({ error: "This funnel requires payment to join.", requiresPayment: true }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (funnel.requireName && !name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  try {
    await createFreeEnrollment(templateId, site.organizationId, { email, name, phone });
  } catch {
    return NextResponse.json({ error: "Could not send your login link — please try again." }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
