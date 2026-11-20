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

      <div style={{ marginBottom: "1.5rem" }}>
        <h1 className="plx-h1">
          Form Submissions
        </h1>
        <p className="plx-body" style={{ color: "var(--plx-muted)", margin: "4px 0 0" }}>
          Messages sent through any form on this site, newest first.
        </p>
      </div>

      <FormDestinationsClient templateId={id} />
      <FormSubmissionsClient templateId={id} />
    </div>
  );
}
