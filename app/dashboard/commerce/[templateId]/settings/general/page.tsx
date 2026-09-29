import { hasProductDetailMarker } from "@/lib/commerce/productDetailLayout";
import { deriveCommerceTheme } from "@/lib/commerce/deriveCommerceTheme";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { Template } from "@/lib/db/contentEntities";
import { GeneralSettingsClient } from "./GeneralSettingsClient";

export default async function CommerceGeneralSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const [{ data: productDetailTemplate }, { data: rootTemplate }] = await Promise.all([
    settings?.productDetailTemplateId ? Template.get({ id: settings.productDetailTemplateId }).go() : Promise.resolve({ data: null }),
    // templateId here IS the site root's own id (CommerceSettings is keyed by it) — its
    // designJson is what lib/commerce/deriveCommerceTheme.ts reads to auto-detect a look
    // when the merchant hasn't set an explicit override below.
    Template.get({ id: templateId }).go(),
  ]);

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
