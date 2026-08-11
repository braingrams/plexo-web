import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isValidUuid } from "@/server/slug";
import { getTierFeatures } from "@/lib/subscription";

export type SiteImportAdminContext = {
  userId: string;
  organizationId: string;
  role: string | null;
  subscriptionPlan: string;
  templateId: string;
};

/**
 * Mirrors lib/blog/adminAuth.ts's resolveBlogAdminSite: every site-import route is scoped to
 * a "site" (a root Template — parentId === null), resolved + ownership-checked in one call.
 * Additionally gates on multiPageSitesEnabled here (rather than per-route) since every
 * site-import route requires it, not just job creation.
 */
export async function resolveSiteImportSite(
  request: NextRequest,
  templateId: string,
): Promise<{ context: SiteImportAdminContext } | { error: NextResponse }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isValidUuid(templateId)) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  const site = await prisma.template.findFirst({
    where: { id: templateId, organizationId: resolved.organizationId, parentId: null },
    select: { id: true },
  });
  if (!site) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  if (!getTierFeatures(resolved.subscriptionPlan).multiPageSitesEnabled) {
    return { error: NextResponse.json({ error: "Importing a full website requires the Ultra plan." }, { status: 403 }) };
  }

  return {
    context: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      role: resolved.role,
      subscriptionPlan: resolved.subscriptionPlan,
      templateId: site.id,
    },
  };
}
