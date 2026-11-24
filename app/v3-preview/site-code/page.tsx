"use client";

import "@/app/dashboard/_v3/v3.css";
import "@/app/dashboard/_v3/hub/hub.css";
import { SiteLayoutClient } from "@/app/dashboard/templates/[id]/site-layout/SiteLayoutClient";

/** DEV ONLY: the Header, footer and code page. Playwright mocks the /api/site-layout calls. */
export default function Page() {
  return <SiteLayoutClient templateId="s1" siteName="Haven Realty" initialEnabled />;
}
