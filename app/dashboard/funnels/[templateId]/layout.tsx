import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template, LmsFunnel, PublishedDomain } from "@/lib/db/contentEntities";
import { PageContainer } from "../../_components/PageContainer";
import { FunnelTabs } from "../_components/FunnelTabs";
import { FunnelSiteHeader } from "../_components/FunnelSiteHeader";

/** Shell for every /dashboard/funnels/[templateId]/* route — validates the funnel in the
 * URL belongs to the caller's org (same ownership-check-once-here convention as Commerce's
 * own layout), then renders the site header + section tabs above whatever the page renders. */
export default async function FunnelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");
  const organizationId = orgResolution.organizationId;

  const [{ data: site }, { data: funnel }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    LmsFunnel.get({ templateId }).go(),
  ]);

  if (!site || site.organizationId !== organizationId || site.parentId || !funnel) notFound();

  const { data: domains } = await PublishedDomain.query.primary({ templateId }).where((attr, op) => op.eq(attr.active, true)).go();

  return (
    <PageContainer>
      <FunnelSiteHeader templateId={templateId} name={site.name} enabled={funnel.enabled ?? false} domain={domains[0]?.domain ?? null} />
      <FunnelTabs templateId={templateId} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </PageContainer>
  );
}
