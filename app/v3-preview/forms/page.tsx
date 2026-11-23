"use client";

import "@/app/dashboard/_v3/hub/hub.css";
import { FormDestinationsClient } from "@/app/dashboard/templates/[id]/form-submissions/FormDestinationsClient";
import { FormSubmissionsClient } from "@/app/dashboard/templates/[id]/form-submissions/FormSubmissionsClient";

/** DEV ONLY: the form messages page with made-up data. Playwright mocks the /api/v1/templates/... calls. */
export default function Page() {
  return (
    <div data-plexo-v3 className="plx-page">
      <div>
        <h1 className="plx-h1">Form messages</h1>
        <p className="plx-body" style={{ margin: "4px 0 0" }}>Messages people sent through the forms on your site, newest first.</p>
      </div>
      <FormDestinationsClient templateId="s1" />
      <FormSubmissionsClient templateId="s1" />
    </div>
  );
}
