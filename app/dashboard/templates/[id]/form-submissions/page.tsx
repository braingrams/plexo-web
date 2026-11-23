import "@/app/dashboard/_v3/hub/hub.css";
import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { FormSubmissionsClient } from "./FormSubmissionsClient";
import { FormDestinationsClient } from "./FormDestinationsClient";
import { SiteToolBack } from "@/app/dashboard/_v3/page/SiteToolBack";

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/form-submissions`);

  return (
    <div data-plexo-v3 className="plx-page">
      <SiteToolBack siteId={id} tab="settings" />

      <div>
        <h1 className="plx-h1">Form messages</h1>
        <p className="plx-body" style={{ margin: "4px 0 0" }}>Messages people sent through the forms on your site, newest first.</p>
      </div>

      <FormDestinationsClient templateId={id} />
      <FormSubmissionsClient templateId={id} />
    </div>
  );
}
