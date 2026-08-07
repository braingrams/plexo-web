import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { DomainsClient } from "./domains-client";
import { headers } from "next/headers";
import { PageContainer } from "../_components/PageContainer";

export default async function DomainsPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      subscriptionPlan: true,
      customDomainLimit: true,
    },
  });

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch the org's published domains
  const publishedDomains = await prisma.publishedDomain.findMany({
    where: { organizationId: orgResolution.organizationId },
    include: {
      template: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch the org's landing pages to link/re-link — root/home pages only. A domain always
  // links to a page tree's root; its sub-pages ride along under that same domain via the
  // page-tree walk in app/pub/[domain]/[[...slug]], they never get an independent
  // PublishedDomain of their own, so listing them here would let someone "link a domain"
  // to a page that can't actually be a site root.
  const landingPages = await prisma.template.findMany({
    where: {
      organizationId: orgResolution.organizationId,
      kind: "LANDING_PAGE",
      parentId: null,
      // Blog post/listing layouts are internal-only — Template rows referenced by a
      // BlogSite's postLayoutTemplateId/listingLayoutTemplateId, never a page a domain
      // should link to directly (see lib/pub/blogLayoutRender.ts).
      isBlogLayout: false,
    },
    select: {
      id: true,
      name: true,
    },
    // Tie-break on createdAt — the org-backfill migration's updateMany bumped every
    // template's updatedAt to the same instant via Prisma's @updatedAt.
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  // Format domains for client
  const domains = publishedDomains.map((d: any) => ({
    id: d.id,
    domain: d.domain,
    type: d.type as "SUBDOMAIN" | "CUSTOM",
    templateId: d.templateId,
    templateName: d.template.name,
    createdAt: d.createdAt.toISOString(),
    dnsVerified: d.dnsVerified,
    dnsVerifiedAt: d.dnsVerifiedAt ? d.dnsVerifiedAt.toISOString() : null,
  }));

  return (
    <PageContainer>
      <DomainsClient
        initialDomains={domains}
        landingPages={landingPages}
        plan={user.subscriptionPlan}
        customLimit={user.customDomainLimit}
      />
    </PageContainer>
  );
}
