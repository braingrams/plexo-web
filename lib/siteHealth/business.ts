import { CommerceAvailabilityRule, CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";
import { tryResolveSiteBrand } from "@/lib/brand/resolveSiteBrand";
import { cleanBusiness, detectFromHtml, hoursFromRules, missingDetails, type BusinessDetails, type Missing } from "./businessMarkup";

export * from "./businessMarkup";

export type BusinessDraft = { details: BusinessDetails; found: string[]; missing: Missing[] };

/** The owner's stored details with everything Plexo already knows filled in around them (stored values always win). */
export async function gatherBusinessDraft(site: { id: string; organizationId: string; name: string; compiledHtml: string }, stored: BusinessDetails | null | undefined): Promise<BusinessDraft> {
  const found: string[] = [];
  const fromPage = detectFromHtml(site.compiledHtml);
  const [brand, commerce, products] = await Promise.all([
    tryResolveSiteBrand({ siteId: site.id, organizationId: site.organizationId }).catch(() => null),
    CommerceSettings.get({ templateId: site.id }).go().then((r) => r.data).catch(() => null),
    CommerceProduct.query.primary({ templateId: site.id }).go({ pages: "all" }).then((r) => r.data).catch(() => []),
  ]);
  const services = products.filter((p) => p.active && p.kind === "SERVICE");
  let rules: { dayOfWeek: number; startMinute: number; endMinute: number }[] = [];
  if (services.length) {
    const sets = await Promise.all(services.slice(0, 20).map((p) => CommerceAvailabilityRule.query.byProduct({ productId: p.id }).go({ pages: "all" }).then((r) => r.data).catch(() => [])));
    rules = sets.flat();
  }
  const base: BusinessDetails = { name: site.name || undefined };
  if (brand?.logoUrl) {
    base.logo = brand.logoUrl;
    found.push("your logo");
  }
  if (fromPage.phone) {
    base.phone = fromPage.phone;
    found.push("the phone number on your page");
  }
  if (fromPage.email) {
    base.email = fromPage.email;
    found.push("the email on your page");
  }
  if (fromPage.sameAs?.length) {
    base.sameAs = fromPage.sameAs;
    found.push("your social profiles");
  }
  if (commerce?.pickupLocation && /\d/.test(commerce.pickupLocation)) {
    // One line the owner wrote for customers; they split it into street and town in the form.
    base.address = { street: commerce.pickupLocation.split(",")[0].trim().slice(0, 200), city: commerce.pickupLocation.split(",")[1]?.trim().slice(0, 100) };
    base.kind = "local";
    found.push("your pickup address");
  }
  if (rules.length) {
    base.hours = hoursFromRules(rules);
    base.kind = base.kind ?? "local";
    found.push("your booking times");
  }
  const details = cleanBusiness({ ...base, ...(stored ?? {}), address: { ...(base.address ?? {}), ...(stored?.address ?? {}) }, sameAs: stored?.sameAs?.length ? stored.sameAs : base.sameAs, hours: stored?.hours?.length ? stored.hours : base.hours });
  return { details, found, missing: missingDetails(details) };
}
