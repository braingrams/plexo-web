import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isValidUuid } from "@/server/slug";

export type BlogAdminContext = {
  userId: string;
  organizationId: string;
  role: string | null;
  templateId: string;
};

/**
 * Every blog admin route is scoped to a "site" (a root Template — parentId === null —
 * the same row PublishedDomain points at). Resolves the caller (session or API key, via
 * the same resolveUser every other dashboard API route uses) AND verifies templateId is
 * actually a root Template owned by their active organization, in one call.
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

  const site = await prisma.template.findFirst({
    where: { id: templateId, organizationId: resolved.organizationId, parentId: null },
    select: { id: true },
  });
  if (!site) {
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
