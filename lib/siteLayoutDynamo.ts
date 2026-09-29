import { NextRequest, NextResponse } from "next/server";
import { redirect, notFound } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { resolveUser } from "@/lib/auth/resolveUser";
import { isValidUuid } from "@/lib/slugUtils";
import { Template } from "@/lib/db/contentEntities";
import type { OrgRole } from "@/server/accessControl";

// DynamoDB-stack port of lib/siteLayout.ts — same behavior, same rationale on every
// function (see that file's comments), just backed by Template/BlogSite/CommerceSettings/
// SiteLayout entity queries instead of Prisma.
//
// findRootTemplateId, getEnabledSiteLayoutRows, spliceLayoutRows, compileWithSiteLayout,
// recompileSiteLayoutDependents, and onTemplateSaved now live in lib/siteLayoutCore.ts (no
// `next/server`/`next/navigation` import there) so lib/commerce/storefrontLayout.ts,
// lib/commerce/productDetailLayout.ts, and lib/lms/funnelStarterDesign.ts — all reachable
// from SOL's standalone Lambda bundle (lambda/sol-chat/index.ts) — can import just what they
// need without pulling next/server/next/navigation into that bundle. Re-exported here so
// every existing call site that already imports them from this file keeps working
// unchanged. See siteLayoutCore.ts's own top-of-file comment for the full story.
export {
  findRootTemplateId,
  getEnabledSiteLayoutRows,
  spliceLayoutRows,
  compileWithSiteLayout,
  recompileSiteLayoutDependents,
  onTemplateSaved,
} from "./siteLayoutCore";

export type SiteLayoutAdminContext = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * Every Site Layout admin route is scoped to a "site" (a root Template — parentId ===
 * null). Same shape as lib/blog/pageAuthDynamo.ts's resolveBlogAdminSite and
 * lib/commerce/adminAuthDynamo.ts's resolveCommerceAdmin, kept as its own copy rather than
 * a shared cross-domain helper, consistent with how those two didn't share one either.
 */
export async function resolveSiteLayoutAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ context: SiteLayoutAdminContext } | { error: NextResponse }> {
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

  return {
    context: { userId: resolved.userId, organizationId: resolved.organizationId, role: resolved.role, templateId: site.id },
  };
}

export interface SiteLayoutPageAccess {
  templateId: string;
  templateName: string;
  organizationId: string;
}

/**
 * Shared by app/dashboard/templates/[id]/site-layout/page.tsx — same session -> active
 * org -> root-Template-ownership flow as lib/blog/pageAuthDynamo.ts's requireBlogSiteAccess.
 */
export async function requireSiteLayoutAccess(templateId: string, redirectPath: string): Promise<SiteLayoutPageAccess> {
  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== orgResolution.organizationId || template.parentId) {
    notFound();
  }

  return { templateId: template.id, templateName: template.name, organizationId: orgResolution.organizationId };
}
