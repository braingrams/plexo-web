import { notFound, redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import type { OrgRole } from "@/server/accessControl";

export type ResolvedCustomContentAdmin = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * Auth + ownership check shared by every /api/v1/templates/[id]/content-types/** route:
 * resolves the caller (session or API key, same as every other admin route — see
 * resolveUser) and confirms templateId belongs to their organization. Same shape as
 * lib/commerce/adminAuthDynamo.ts's resolveCommerceAdmin, but deliberately does NOT require
 * templateId to be a root/parentless Template the way that one does — content types are a
 * per-template (any page, not just a site root) concept, same scoping Comment
 * (lib/db/contentEntities.ts) already uses.
 */
export async function resolveCustomContentAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ error: NextResponse; context?: undefined } | { error?: undefined; context: ResolvedCustomContentAdmin }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 }) };
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return { error: NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 }) };
  }

  return {
    context: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      role: resolved.role,
      templateId,
    },
  };
}

export interface CustomContentPageAccess {
  templateId: string;
  templateName: string;
  organizationId: string;
}

/**
 * Server-component counterpart to resolveCustomContentAdmin, shared by
 * app/dashboard/templates/[id]/content-types/page.tsx and its entries sub-page — same
 * session -> active org -> template-ownership flow as lib/siteLayoutDynamo.ts's
 * requireSiteLayoutAccess, minus that one's root-Template-only restriction (content types
 * are a per-template concept, not a per-site one — see resolveCustomContentAdmin's comment).
 */
export async function requireCustomContentPageAccess(templateId: string, redirectPath: string): Promise<CustomContentPageAccess> {
  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== orgResolution.organizationId) {
    notFound();
  }

  return { templateId: template.id, templateName: template.name, organizationId: orgResolution.organizationId };
}
