import { notFound, redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { findRootTemplateId } from "@/lib/siteLayoutDynamo";
import { buildLivePreviewHtml } from "@/lib/buildLivePreviewHtml";
import { Template, TemplateAsset, PublishedDomain, BlogSite, SiteLayout } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { PageView, FormSubmission } from "@/lib/db/opsEntities";

import { DetailClient } from "./detail-client";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async function TemplateDetailPage(
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=/dashboard/templates/${params.id}/detail`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // A sub-page id landed here (nothing in the dashboard links to one directly today, but
  // this keeps the route honest if ever hit by hand) — Domain/Traffic/Blog/Site
  // Layout/Commerce are all site-wide concepts scoped to the root, so redirect there
  // instead of rendering a half-empty detail page for a page that has none of them.
  const { data: found } = await Template.get({ id: params.id }).go();
  if (!found || found.organizationId !== orgResolution.organizationId) {
    notFound();
  }
  if (found.parentId) {
    const rootId = await findRootTemplateId(found.id, found.parentId);
    redirect(`/dashboard/templates/${rootId}/detail`);
  }

  const template = found;

  const [{ data: assets }, { data: children }, { data: submissions }] = await Promise.all([
    TemplateAsset.query.primary({ templateId: template.id }).go(),
    Template.query.byParent({ parentId: template.id }).go(),
    FormSubmission.query.primary({ templateId: template.id }).go(),
  ]);

  const previewHtml = await buildLivePreviewHtml(template.compiledHtml, assets.map((a) => ({ path: a.path, blobUrl: a.blobUrl })));

  let siteData: {
    domain: { domain: string; type: string; dnsVerified: boolean; active: boolean } | null;
    pageViews30d: number;
    blogEnabled: boolean;
    siteLayoutEnabled: boolean;
    commerceEnabled: boolean;
  } | null = null;

  if (template.kind === "LANDING_PAGE") {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const now = new Date().toISOString();
    const [{ data: domains }, { data: pageViews }, { data: blogSite }, { data: siteLayout }, { data: commerceSettings }] = await Promise.all([
      PublishedDomain.query.primary({ templateId: template.id }).go(),
      PageView.query.primary({ templateId: template.id }).between({ createdAt: since }, { createdAt: now }).go({ pages: "all" }),
      BlogSite.get({ templateId: template.id }).go(),
      SiteLayout.get({ templateId: template.id }).go(),
      CommerceSettings.get({ templateId: template.id }).go(),
    ]);

    const domain = domains[0] ?? null;

    siteData = {
      domain: domain ? { domain: domain.domain, type: domain.type, dnsVerified: domain.dnsVerified ?? false, active: domain.active ?? true } : null,
      pageViews30d: pageViews.length,
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
      sourceType={template.sourceType ?? "BUILDER"}
      isBlogLayout={template.isBlogLayout ?? false}
      createdAt={template.createdAt ?? new Date().toISOString()}
      updatedAt={template.updatedAt ?? new Date().toISOString()}
      compiledAt={template.compiledAt ?? null}
      designJson={template.designJson}
      compiledHtml={template.compiledHtml}
      previewHtml={previewHtml}
      pageCount={children.length}
      formSubmissionCount={submissions.length}
      siteData={siteData}
    />
  );
}
