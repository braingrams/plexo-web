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
      where: { organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false, isSiteLayoutFragment: false, isCommerceLayout: false },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!site) notFound();

  return (
    <PageContainer>
      {/* Below md the fixed-width sub-nav rail would otherwise squeeze page content into a
       * sliver (see CommerceNav) — stack the rail above the content and let CommerceNav
       * switch to a horizontally-scrolling pill row itself. */}
      <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-8">
        <div className="flex flex-col gap-4 md:w-[190px] md:shrink-0 md:gap-6">
          <CommerceSiteSwitcher sites={sites} currentTemplateId={templateId} />
          <CommerceNav templateId={templateId} />
        </div>
        <div style={{ minWidth: 0 }} className="flex-1">{children}</div>
      </div>
    </PageContainer>
  );
}
