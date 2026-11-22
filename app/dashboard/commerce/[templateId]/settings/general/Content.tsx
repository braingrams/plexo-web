import { hasProductDetailMarker } from "@/lib/commerce/productDetailLayout";
import { deriveCommerceTheme } from "@/lib/commerce/deriveCommerceTheme";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { Template } from "@/lib/db/contentEntities";
import { GeneralSettingsClient } from "./GeneralSettingsClient";
import { GeneralPanel } from "@/app/dashboard/_v3/hub/shop/GeneralPanel";
import { getStorefrontSlug } from "@/lib/commerce/storefrontLayout";
import { CommerceOrder } from "@/lib/db/commerceEntities";

export async function GeneralSettingsContent({ templateId, hub }: { templateId: string; hub?: boolean }) {
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const [{ data: productDetailTemplate }, { data: rootTemplate }] = await Promise.all([
    settings?.productDetailTemplateId ? Template.get({ id: settings.productDetailTemplateId }).go() : Promise.resolve({ data: null }),
    // templateId here IS the site root's own id (CommerceSettings is keyed by it) — its
    // designJson is what lib/commerce/deriveCommerceTheme.ts reads to auto-detect a look
    // when the merchant hasn't set an explicit override below.
    Template.get({ id: templateId }).go(),
  ]);

  if (hub) {
    const [slug, { data: someOrder }] = await Promise.all([getStorefrontSlug(templateId), CommerceOrder.query.primary({ templateId }).go({ pages: 1, limit: 1 })]);
    return (
      <GeneralPanel
        templateId={templateId}
        initial={{
          siteName: rootTemplate?.name ?? "",
          enabled: settings?.enabled ?? false,
          currency: settings?.currency ?? "NGN",
          storefrontSlug: slug ?? null,
          notificationEmail: settings?.notificationEmail ?? "",
          hasOrders: someOrder.length > 0,
          productDetailLayout: productDetailTemplate ? { templateId: productDetailTemplate.id, ready: hasProductDetailMarker(productDetailTemplate.compiledHtml) } : null,
          themeAccentColor: settings?.themeAccentColor ?? null,
          themeButtonRadius: settings?.themeButtonRadius ?? null,
          autoDetectedTheme: deriveCommerceTheme(rootTemplate?.designJson),
        }}
      />
    );
  }
  return (
    <GeneralSettingsClient
      templateId={templateId}
      initial={{
        enabled: settings?.enabled ?? false,
        currency: settings?.currency ?? "NGN",
        productDetailLayout: productDetailTemplate
          ? { templateId: productDetailTemplate.id, ready: hasProductDetailMarker(productDetailTemplate.compiledHtml) }
          : null,
        themeAccentColor: settings?.themeAccentColor ?? null,
        themeButtonRadius: settings?.themeButtonRadius ?? null,
        autoDetectedTheme: deriveCommerceTheme(rootTemplate?.designJson),
      }}
    />
  );
}
