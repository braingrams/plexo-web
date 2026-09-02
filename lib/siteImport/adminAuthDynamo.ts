import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { isValidUuid } from "@/lib/slugUtils";
import { getTierFeatures } from "@/lib/subscription";
import { Template } from "@/lib/db/contentEntities";
import type { OrgRole } from "@/server/accessControl";

export type SiteImportAdminContext = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  subscriptionPlan: string;
  templateId: string;
};

/**
 * Mirrors lib/blog/pageAuthDynamo.ts's resolveBlogAdminSite: every site-import route is
 * scoped to a "site" (a root Template — parentId === null), resolved + ownership-checked
 * in one call. Additionally gates on multiPageSitesEnabled here (rather than per-route)
 * since every site-import route requires it, not just job creation.
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

  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
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
