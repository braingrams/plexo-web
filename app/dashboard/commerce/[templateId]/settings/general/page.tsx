import { hasProductDetailMarker } from "@/lib/commerce/productDetailLayout";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { Template } from "@/lib/db/contentEntities";
import { GeneralSettingsClient } from "./GeneralSettingsClient";

export default async function CommerceGeneralSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const { data: productDetailTemplate } = settings?.productDetailTemplateId
    ? await Template.get({ id: settings.productDetailTemplateId }).go()
    : { data: null };

  return (
    <GeneralSettingsClient
      templateId={templateId}
      initial={{
        enabled: settings?.enabled ?? false,
        currency: settings?.currency ?? "NGN",
        productDetailLayout: productDetailTemplate
          ? { templateId: productDetailTemplate.id, ready: hasProductDetailMarker(productDetailTemplate.compiledHtml) }
          : null,
      }}
    />
  );
}
