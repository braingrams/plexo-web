import { prisma } from "@/server/prisma";
import { requireSiteLayoutAccess } from "@/lib/siteLayout";
import { SiteLayoutClient } from "./SiteLayoutClient";

export default async function SiteLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/site-layout`);

  const layout = await prisma.siteLayout.findUnique({
    where: { templateId: access.templateId },
    include: {
      headerTemplate: { select: { id: true, updatedAt: true } },
      footerTemplate: { select: { id: true, updatedAt: true } },
    },
  });

  return (
    <SiteLayoutClient
      templateId={access.templateId}
      siteName={access.templateName}
      initialEnabled={layout?.enabled ?? false}
      header={layout?.headerTemplate ? { templateId: layout.headerTemplate.id, updatedAt: layout.headerTemplate.updatedAt.toISOString() } : null}
      footer={layout?.footerTemplate ? { templateId: layout.footerTemplate.id, updatedAt: layout.footerTemplate.updatedAt.toISOString() } : null}
    />
  );
}
