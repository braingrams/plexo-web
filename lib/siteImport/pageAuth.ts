import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { getTierFeatures } from "@/lib/subscription";

export interface SiteImportPageAccess {
  templateId: string;
  templateName: string;
  organizationId: string;
  userId: string;
  isUltra: boolean;
}

/**
 * Server-component analogue of lib/siteImport/adminAuth.ts's resolveSiteImportSite (which
 * operates on a NextRequest, for API routes) — mirrors lib/blog/pageAuth.ts's
 * requireBlogSiteAccess exactly (session -> active org -> root Template ownership).
 */
export async function requireSiteImportAccess(templateId: string, redirectPath: string): Promise<SiteImportPageAccess> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const template = await prisma.template.findFirst({
    where: { id: templateId, organizationId: orgResolution.organizationId, parentId: null },
    select: { id: true, name: true },
  });
  if (!template) {
    notFound();
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { subscriptionPlan: true } });

  return {
    templateId: template.id,
    templateName: template.name,
    organizationId: orgResolution.organizationId,
    userId: session.user.id,
    isUltra: getTierFeatures(user?.subscriptionPlan).multiPageSitesEnabled,
  };
}
