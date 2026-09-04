import { redirect, notFound } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { findRootTemplateId } from "@/lib/siteLayoutDynamo";
import { Template, BlogRedirect } from "@/lib/db/contentEntities";

import { RedirectsClient, type RedirectSummary } from "./RedirectsClient";

export default async function RedirectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=/dashboard/templates/${id}/redirects`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: found } = await Template.get({ id }).go();
  if (!found || found.organizationId !== orgResolution.organizationId) {
    notFound();
  }

  // Redirects are always stored against the root site id — see BlogRedirect's own entity
  // comment in lib/db/contentEntities.ts and lib/blog/redirectsDynamo.ts. A sub-page id
  // landed here (nothing links to one directly today) gets sent to its site's page, same
  // as TemplateDetailPage does for the equivalent case.
  if (found.parentId) {
    const rootId = await findRootTemplateId(found.id, found.parentId);
    redirect(`/dashboard/templates/${rootId}/redirects`);
  }

  const { data: redirects } = await BlogRedirect.query.primary({ templateId: found.id }).go();
  redirects.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const initialRedirects: RedirectSummary[] = redirects.map((r) => ({
    fromPath: r.fromPath,
    toPath: r.toPath,
    createdAt: r.createdAt ?? new Date().toISOString(),
  }));

  return <RedirectsClient templateId={found.id} initialRedirects={initialRedirects} />;
}
