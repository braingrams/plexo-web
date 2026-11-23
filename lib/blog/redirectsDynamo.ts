import { NextRequest, NextResponse } from "next/server";
import { BlogRedirect, Template } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import type { OrgRole } from "@/server/accessControl";

import { normalizeRedirectPath, normalizeRedirectTarget } from "@/lib/redirects/paths";
export { normalizeRedirectPath, normalizeRedirectTarget };

/** fromPath is BlogRedirect's own sort key (see contentEntities.ts) — an O(1) .get(), not a scan. */
export async function resolveBlogRedirect(templateId: string, path: string): Promise<string | null> {
  const { data } = await BlogRedirect.get({ templateId, fromPath: normalizeRedirectPath(path) }).go();
  return data?.toPath ?? null;
}

/** Like resolveBlogRedirect, with whether it is permanent (301, the default) or for now (302). */
export async function resolveRedirectFull(templateId: string, path: string): Promise<{ toPath: string; status: 301 | 302 } | null> {
  const { data } = await BlogRedirect.get({ templateId, fromPath: normalizeRedirectPath(path) }).go();
  return data ? { toPath: data.toPath, status: data.permanent === false ? 302 : 301 } : null;
}

export type ResolvedRedirectAdmin = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * Auth + ownership check shared by every /api/v1/templates/[id]/redirects/* route — same
 * shape as commerce's resolveCommerceAdmin (lib/commerce/adminAuthDynamo.ts): resolves the
 * caller (session or API key, via resolveUser) and confirms templateId is a root Template
 * ("site") belonging to their organization. BlogRedirect rows are always written against
 * the root site id (see lib/blogImport/redirectsDynamo.ts's createRedirectsForImportedPost
 * and every resolveBlogRedirect call site in app/pub/[domain]/[[...slug]]/route.ts), never
 * a sub-page id. Returns a ready-to-return NextResponse on any failure, or context to
 * proceed with.
 */
export async function resolveRedirectAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ error: NextResponse; context?: undefined } | { error?: undefined; context: ResolvedRedirectAdmin }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
      templateId,
    },
  };
}
