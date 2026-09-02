import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { SiteLayoutClient } from "./SiteLayoutClient";

export default async function SiteLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/site-layout`);

  const { data: layout } = await SiteLayout.get({ templateId: access.templateId }).go();
  const [header, footer] = await Promise.all([
    layout?.headerTemplateId ? Template.get({ id: layout.headerTemplateId }).go() : null,
    layout?.footerTemplateId ? Template.get({ id: layout.footerTemplateId }).go() : null,
  ]);

  return (
    <SiteLayoutClient
      templateId={access.templateId}
      siteName={access.templateName}
      initialEnabled={layout?.enabled ?? false}
      header={header?.data ? { templateId: header.data.id, updatedAt: header.data.updatedAt ?? new Date().toISOString() } : null}
      footer={footer?.data ? { templateId: footer.data.id, updatedAt: footer.data.updatedAt ?? new Date().toISOString() } : null}
    />
  );
}
