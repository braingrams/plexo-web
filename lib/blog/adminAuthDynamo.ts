import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { isValidUuid } from "@/server/slugDynamo";
import type { OrgRole } from "@/server/accessControl";

export type BlogAdminContext = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * DynamoDB-stack port of lib/blog/adminAuth.ts — same contract, same rationale (see that
 * file's own comment).
 */
export async function resolveBlogAdminSite(
  request: NextRequest,
  templateId: string,
): Promise<{ context: BlogAdminContext } | { error: NextResponse }> {
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
    context: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      role: resolved.role,
      templateId: site.id,
    },
  };
}
