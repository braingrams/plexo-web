import { NextRequest, NextResponse } from "next/server";
import { BlogRedirect, Template } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import type { OrgRole } from "@/server/accessControl";

/**
 * Canonical form BlogRedirect.fromPath/toPath are always stored and looked up in
 * (leading slash, no trailing slash) — used both when the WordPress importer writes a
 * redirect row and here when reading it back, so the two never drift out of sync.
 */
export function normalizeRedirectPath(path: string): string {
  return "/" + path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Same normalization as normalizeRedirectPath, but for a redirect's *target* (toPath),
 * which — unlike fromPath — is allowed to be an absolute URL (redirecting off-site). An
 * absolute http(s) URL is left untouched; anything else is treated as a relative path and
 * normalized the same way fromPath is.
 */
export function normalizeRedirectTarget(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return normalizeRedirectPath(path);
}

/** fromPath is BlogRedirect's own sort key (see contentEntities.ts) — an O(1) .get(), not a scan. */
export async function resolveBlogRedirect(templateId: string, path: string): Promise<string | null> {
  const { data } = await BlogRedirect.get({ templateId, fromPath: normalizeRedirectPath(path) }).go();
  return data?.toPath ?? null;
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
