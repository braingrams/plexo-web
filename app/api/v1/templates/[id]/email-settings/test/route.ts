import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { User } from "@/lib/db/coreEntities";
import { getOrganizationOwnerEntitlementDynamo } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { planGateResponse } from "@/lib/plan/planGateResponse";
import { emailShell, resolveMaildripApiKey, sendCommerceEmail, sendMaildripEmail } from "@/lib/mail/maildrip";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveCommerceAdmin(request, id);
  if (auth.error) return auth.error;
  const { organizationId, userId } = auth.context;

  const [{ data: template }, { data: settings }, { data: user }, { subscriptionPlan, onTrial }] = await Promise.all([
    Template.get({ id }).go(),
    CommerceSettings.get({ templateId: id }).go(),
    User.get({ id: userId }).go(),
    getOrganizationOwnerEntitlementDynamo(organizationId),
  ]);

  if (!template) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  const features = getTierFeatures(subscriptionPlan, { trial: onTrial });
  if (!features.whiteLabelEnabled) {
    return planGateResponse("PLAN_BRANDING", "Custom email branding is part of the Enterprise plan.");
  }

  const body = (await request.json().catch(() => ({}))) as { toEmail?: string };
  const to = (typeof body.toEmail === "string" && body.toEmail.includes("@") ? body.toEmail.trim() : user?.email) || "";
  if (!to) {
    return NextResponse.json({ error: "Recipient email address is required." }, { status: 400 });
  }

  const siteBrand = (template.brand as { logoUrl?: string; colors?: string[] } | null) ?? null;
  const senderName = settings?.emailSenderName || template.name;
  const brandColor = settings?.emailBrandColor || siteBrand?.colors?.[0] || "#111111";
  const logoUrl = settings?.emailLogoUrl || siteBrand?.logoUrl;
  const customFooterText = settings?.emailFooterText?.trim() || "";

  const bodyHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; color: #111111;">
      <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 800; color: #111111; letter-spacing: -0.4px;">
        Thank you for your payment
      </h1>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px; color: #374151;">
        Hi! We've received your payment successfully. Thank you for choosing ${senderName}. We appreciate your business and look forward to serving you!
      </p>

      <div style="background: #F8F9FA; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #E5E7EB; padding-bottom: 12px; margin-bottom: 12px;">
          <span style="font-size: 13px; color: #6B7280;">Test Receipt</span>
          <span style="font-size: 13px; font-weight: 600; color: #111111;">#TEST-8492</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 15px; font-weight: 500;">Sample Product / Service</span>
          <span style="font-size: 18px; font-weight: 700; color: ${brandColor};">$1.00</span>
        </div>
        <div style="font-size: 12px; color: #9CA3AF;">
          Payment received successfully via ${senderName}
        </div>
      </div>

      <div style="border-top: 1px solid #E5E7EB; padding-top: 16px; font-size: 12px; color: #6B7280;">
        This is a live test email sent from your Plexo custom email branding settings to preview how your receipts look in inboxes.
      </div>
    </div>
  `;

  const footerHtml = customFooterText
    ? `<p style="margin: 0 0 8px; font-size: 12.5px; color: #6B7280; line-height: 1.5;">${customFooterText}</p>`
    : undefined;

  const html = emailShell({
    title: `Payment receipt from ${senderName}`,
    bodyHtml,
    footerHtml,
    brand: {
      name: senderName,
      logoUrl: logoUrl || undefined,
      color: brandColor,
    },
    preheader: `Test payment receipt for $1.00 from ${senderName}`,
  });

  const maildripKey = resolveMaildripApiKey(settings ?? {});
  if (maildripKey) {
    await sendCommerceEmail(maildripKey, {
      to,
      subject: `[Test Receipt] Payment to ${senderName}`,
      html,
      fromName: senderName,
      fromEmail: settings?.emailSenderEmail || undefined,
      context: "commerce_receipt",
      organizationId,
      templateId: id,
    });
  } else {
    await sendMaildripEmail({
      to,
      subject: `[Test Receipt] Payment to ${senderName}`,
      html,
      fromName: senderName,
      fromEmail: settings?.emailSenderEmail || undefined,
    });
  }

  return NextResponse.json({ success: true, to });
}
