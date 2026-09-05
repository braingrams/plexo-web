import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import type { OrgRole } from "@/server/accessControl";

export type ResolvedLmsAdmin = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * Auth + ownership check shared by every /api/v1/lms/funnels/[templateId]/* admin route —
 * same shape as lib/commerce/adminAuthDynamo.ts's resolveCommerceAdmin: resolves the caller
 * and confirms templateId is a root Template (a "site") belonging to their organization.
 */
export async function resolveLmsAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ error: NextResponse; context?: undefined } | { error?: undefined; context: ResolvedLmsAdmin }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    return { error: NextResponse.json({ error: "Funnel not found." }, { status: 404 }) };
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
