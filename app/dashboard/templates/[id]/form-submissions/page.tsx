import Link from "next/link";

import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { PageContainer } from "../../../_components/PageContainer";
import { FormSubmissionsClient } from "./FormSubmissionsClient";

function IconArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/form-submissions`);

  return (
    <PageContainer>
      <Link href={`/dashboard/templates/${id}/detail`} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.5)", textDecoration: "none", marginBottom: "1.5rem" }}>
        <IconArrowLeft /> {access.templateName}
      </Link>

      <div style={{ marginBottom: "2rem" }}>
        <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.35rem" }}>
          {access.templateName}
        </p>
        <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.02em" }}>
          Form Submissions
        </h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", marginTop: "0.4rem" }}>
          Messages sent through any form on this site, newest first — showing the last up to 200.
        </p>
      </div>

      <FormSubmissionsClient templateId={id} />
    </PageContainer>
  );
}
