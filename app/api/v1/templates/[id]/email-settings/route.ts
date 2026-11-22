import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { getOrganizationOwnerEntitlementDynamo } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { planGateResponse } from "@/lib/plan/planGateResponse";

/**
 * GET /api/v1/templates/:id/email-settings
 * Returns the site's email branding, sender configuration, and MailDrip connection status,
 * along with enterprise entitlement status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveCommerceAdmin(request, id);
  if (auth.error) return auth.error;
  const { organizationId } = auth.context;

  const [{ data: template }, { data: settings }, { subscriptionPlan, onTrial }] = await Promise.all([
    Template.get({ id }).go(),
    CommerceSettings.get({ templateId: id }).go(),
    getOrganizationOwnerEntitlementDynamo(organizationId),
  ]);

  if (!template) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  const features = getTierFeatures(subscriptionPlan, { trial: onTrial });
  const enterprise = Boolean(features.whiteLabelEnabled);
  const siteBrand = (template.brand as { logoUrl?: string; colors?: string[] } | null) ?? null;

  return NextResponse.json({
    enterprise,
    plan: subscriptionPlan,
    emailBrandEnabled: Boolean(settings?.emailBrandEnabled),
    emailSenderName: settings?.emailSenderName || template.name,
    emailSenderEmail: settings?.emailSenderEmail || "",
    emailLogoUrl: settings?.emailLogoUrl || siteBrand?.logoUrl || "",
    emailBrandColor: settings?.emailBrandColor || siteBrand?.colors?.[0] || "",
    emailFooterText: settings?.emailFooterText || "",
    siteName: template.name,
    siteLogoUrl: siteBrand?.logoUrl || "",
    siteBrandColor: siteBrand?.colors?.[0] || "",
    maildripConnected: Boolean(settings?.maildripApiKeyEncrypted),
    maildripConnectedEmail: settings?.maildripConnectedEmail ?? null,
  });
}

/**
 * PUT /api/v1/templates/:id/email-settings
 * Updates the site's email branding settings. Gated to Enterprise tier accounts.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveCommerceAdmin(request, id);
  if (auth.error) return auth.error;
  const { organizationId } = auth.context;

  const { subscriptionPlan, onTrial } = await getOrganizationOwnerEntitlementDynamo(organizationId);
  const features = getTierFeatures(subscriptionPlan, { trial: onTrial });
  if (!features.whiteLabelEnabled) {
    return planGateResponse(
      "PLAN_BRANDING",
      "Per-site email branding and custom Maildrip sending is part of the Enterprise plan.",
      "ENTERPRISE",
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const emailBrandEnabled = typeof body.emailBrandEnabled === "boolean" ? body.emailBrandEnabled : undefined;
  const emailSenderName = typeof body.emailSenderName === "string" ? body.emailSenderName.trim().slice(0, 80) : undefined;
  const emailSenderEmail = typeof body.emailSenderEmail === "string" ? body.emailSenderEmail.trim().slice(0, 120) : undefined;
  const emailLogoUrl = typeof body.emailLogoUrl === "string" ? body.emailLogoUrl.trim() : undefined;
  const emailBrandColor = typeof body.emailBrandColor === "string" ? body.emailBrandColor.trim().slice(0, 30) : undefined;
  const emailFooterText = typeof body.emailFooterText === "string" ? body.emailFooterText.trim().slice(0, 300) : undefined;

  const { data: existing } = await CommerceSettings.get({ templateId: id }).go();
  const updatePayload: Record<string, unknown> = {};
  if (emailBrandEnabled !== undefined) updatePayload.emailBrandEnabled = emailBrandEnabled;
  if (emailSenderName !== undefined) updatePayload.emailSenderName = emailSenderName;
  if (emailSenderEmail !== undefined) updatePayload.emailSenderEmail = emailSenderEmail;
  if (emailLogoUrl !== undefined) updatePayload.emailLogoUrl = emailLogoUrl;
  if (emailBrandColor !== undefined) updatePayload.emailBrandColor = emailBrandColor;
  if (emailFooterText !== undefined) updatePayload.emailFooterText = emailFooterText;

  if (existing) {
    await CommerceSettings.patch({ templateId: id }).set(updatePayload).go();
  } else {
    await CommerceSettings.create({
      id: randomUUID(),
      templateId: id,
      organizationId,
      ...updatePayload,
    }).go();
  }

  return NextResponse.json({ ok: true });
}
