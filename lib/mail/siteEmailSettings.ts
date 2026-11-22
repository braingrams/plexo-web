import { Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { getOrganizationOwnerEntitlementDynamo, getOrgBrandDynamo } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { resolveMaildripApiKey, type EmailBrand } from "@/lib/mail/maildrip";

export type SiteEmailConfig = {
  /** The MailDrip API key to send through (BYO site key, or shared platform key). */
  apiKey: string | null;
  /** Branded shell details: sender display name, logo URL, and accent color. */
  brand?: EmailBrand;
  /** Explicit sender name ("From Name"). */
  fromName?: string;
  /** Explicit sender email ("From Email"). */
  fromEmail?: string;
  /** Optional custom footer text for transactional emails. */
  footerText?: string;
  /** Whether this site's organization is on the Enterprise tier. */
  isEnterprise: boolean;
};

/**
 * Resolves the outbound email configuration for a given site (templateId).
 *
 * Entitlement:
 * - Per-site email branding and custom MailDrip sending is gated to Enterprise tier accounts
 *   (governed by `whiteLabelEnabled`).
 * - When Enterprise and `emailBrandEnabled` is true on CommerceSettings:
 *   - The site's custom sender name, sender email, logo URL, brand color, and footer are used.
 *   - The site's connected MailDrip API key is used for delivery.
 * - When Enterprise but site-specific email branding is not enabled:
 *   - Falls back to the account-level organization brand (if configured via White Label).
 * - For non-Enterprise tiers:
 *   - Default platform branding and delivery is used.
 */
export async function resolveSiteEmailConfig(
  templateId: string,
  organizationId?: string,
): Promise<SiteEmailConfig> {
  const [{ data: template }, { data: settings }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    CommerceSettings.get({ templateId }).go(),
  ]);

  const orgId = organizationId || template?.organizationId;
  let isEnterprise = false;
  if (orgId) {
    try {
      const entitlement = await getOrganizationOwnerEntitlementDynamo(orgId);
      const features = getTierFeatures(entitlement.subscriptionPlan, { trial: entitlement.onTrial });
      isEnterprise = Boolean(features.whiteLabelEnabled);
    } catch {
      isEnterprise = false;
    }
  }

  // BYO Maildrip apiKey: if site has maildripApiKeyEncrypted, decrypt it. Otherwise fallback to platform key.
  const apiKey = settings ? resolveMaildripApiKey(settings) : null;

  // Site-level brand assets
  const siteBrand = (template?.brand as { logoUrl?: string; colors?: string[] } | null) ?? null;

  if (isEnterprise && settings?.emailBrandEnabled) {
    const brand: EmailBrand = {
      name: settings.emailSenderName || template?.name || "Plexo",
      logoUrl: settings.emailLogoUrl || siteBrand?.logoUrl || undefined,
      color: settings.emailBrandColor || siteBrand?.colors?.[0] || undefined,
    };
    return {
      apiKey,
      brand,
      fromName: settings.emailSenderName || template?.name || undefined,
      fromEmail: settings.emailSenderEmail || undefined,
      footerText: settings.emailFooterText || undefined,
      isEnterprise: true,
    };
  }

  // If enterprise but site branding is not explicitly enabled, check org brand
  if (isEnterprise && orgId) {
    const orgBrand = await getOrgBrandDynamo(orgId);
    if (orgBrand) {
      return {
        apiKey,
        brand: {
          name: orgBrand.name,
          logoUrl: orgBrand.logoUrl,
          color: orgBrand.color,
        },
        isEnterprise: true,
      };
    }
  }

  return {
    apiKey,
    brand: undefined,
    isEnterprise,
  };
}
