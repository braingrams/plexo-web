import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { SiteLayout } from "@/lib/db/contentEntities";
import { ensureBlankSiteLayout } from "@/lib/siteLayoutBlank";
import { auth } from "@/server/authDynamo";
import { SiteLayoutClient } from "./SiteLayoutClient";
import { SiteToolBack } from "@/app/dashboard/_v3/page/SiteToolBack";

export default async function SiteLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/site-layout`);

  // An older site gets its (blank) header and footer the first time this opens; nothing visitors see changes.
  const session = await auth();
  if (session?.user) await ensureBlankSiteLayout(access.templateId, session.user.id).catch(() => undefined);
  const { data: layout } = await SiteLayout.get({ templateId: access.templateId }).go();

  return (
    <>
      <SiteToolBack siteId={access.templateId} tab="pages" />
      <SiteLayoutClient templateId={access.templateId} siteName={access.templateName} initialEnabled={layout?.enabled ?? false} />
    </>
  );
}
