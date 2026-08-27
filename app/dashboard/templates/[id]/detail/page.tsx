import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { findRootTemplateId } from "@/lib/siteLayout";

import { DetailClient } from "./detail-client";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async function TemplateDetailPage(
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=/dashboard/templates/${params.id}/detail`);
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // A sub-page id landed here (nothing in the dashboard links to one directly today, but
  // this keeps the route honest if ever hit by hand) — Domain/Traffic/Blog/Site
  // Layout/Commerce are all site-wide concepts scoped to the root, so redirect there
  // instead of rendering a half-empty detail page for a page that has none of them.
  const found = await prisma.template.findFirst({
    where: { id: params.id, organizationId: orgResolution.organizationId },
    select: { id: true, parentId: true },
  });
  if (!found) {
    notFound();
  }
  if (found.parentId) {
    const rootId = await findRootTemplateId(found.id, found.parentId);
    redirect(`/dashboard/templates/${rootId}/detail`);
  }

  const template = await prisma.template.findFirst({
    where: { id: params.id, organizationId: orgResolution.organizationId, parentId: null },
    select: {
      id: true,
      name: true,
      kind: true,
      sourceType: true,
      isBlogLayout: true,
      createdAt: true,
      updatedAt: true,
      compiledAt: true,
      designJson: true,
      compiledHtml: true,
      _count: { select: { pages: true, formSubmissions: true } },
    },
  });
  if (!template) {
    notFound();
  }

  let siteData: {
    domain: { domain: string; type: string; dnsVerified: boolean; active: boolean } | null;
    pageViews30d: number;
    blogEnabled: boolean;
    siteLayoutEnabled: boolean;
    commerceEnabled: boolean;
  } | null = null;

  if (template.kind === "LANDING_PAGE") {
    const [domain, pageViews30d, blogSite, siteLayout, commerceSettings] = await Promise.all([
      prisma.publishedDomain.findFirst({
        where: { templateId: template.id },
        select: { domain: true, type: true, dnsVerified: true, active: true },
      }),
      prisma.pageView.count({
        where: { templateId: template.id, createdAt: { gte: new Date(Date.now() - THIRTY_DAYS_MS) } },
      }),
      prisma.blogSite.findUnique({ where: { templateId: template.id }, select: { enabled: true } }),
      prisma.siteLayout.findUnique({ where: { templateId: template.id }, select: { enabled: true } }),
      prisma.commerceSettings.findUnique({ where: { templateId: template.id }, select: { enabled: true } }),
    ]);

    siteData = {
      domain,
      pageViews30d,
      blogEnabled: blogSite?.enabled ?? false,
      siteLayoutEnabled: siteLayout?.enabled ?? false,
      commerceEnabled: commerceSettings?.enabled ?? false,
    };
  }

  return (
    <DetailClient
      templateId={template.id}
      templateName={template.name}
      templateKind={template.kind}
      sourceType={template.sourceType}
      isBlogLayout={template.isBlogLayout}
      createdAt={template.createdAt.toISOString()}
      updatedAt={template.updatedAt.toISOString()}
      compiledAt={template.compiledAt ? template.compiledAt.toISOString() : null}
      designJson={template.designJson}
      compiledHtml={template.compiledHtml}
      pageCount={template._count.pages}
      formSubmissionCount={template._count.formSubmissions}
      siteData={siteData}
    />
  );
}
