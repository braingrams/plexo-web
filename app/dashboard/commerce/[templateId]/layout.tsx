import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { PageContainer } from "../../_components/PageContainer";
import { CommerceNav } from "../_components/CommerceNav";
import { CommerceSiteSwitcher } from "../_components/CommerceSiteSwitcher";

/** Shell for every /dashboard/commerce/[templateId]/* route: validates the site in the
 * URL actually belongs to the caller's active org (parentId: null — a "site" is always a
 * root Template, same convention Blog/Pages already use), then renders the site switcher
 * + sub-nav beside whatever the page renders. This is the one place that check happens —
 * leaf pages below trust it, since a failed check redirects/404s before any child renders. */
export default async function CommerceSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login");

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");
  const organizationId = orgResolution.organizationId;

  const [site, sites] = await Promise.all([
    prisma.template.findFirst({
      where: { id: templateId, organizationId, parentId: null },
      select: { id: true },
    }),
    prisma.template.findMany({
      where: { organizationId, parentId: null },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!site) notFound();

  return (
    <PageContainer>
      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
        <div style={{ width: 190, flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <CommerceSiteSwitcher sites={sites} currentTemplateId={templateId} />
          <CommerceNav templateId={templateId} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </PageContainer>
  );
}
