import { prisma } from "@/server/prisma";

/**
 * Canonical form BlogRedirect.fromPath/toPath are always stored and looked up in
 * (leading slash, no trailing slash) — used both when the WordPress importer writes a
 * redirect row and here when reading it back, so the two never drift out of sync.
 */
export function normalizeRedirectPath(path: string): string {
  return "/" + path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Looks up a BlogRedirect for `path` scoped to a site's root templateId. Populated
 * automatically by the WordPress importer (one row per historical permalink the source
 * site reported, plus its numeric-id shortlink form) and by in-Plexo slug renames, so
 * neither an old WordPress URL nor a renamed post silently 404s. Returns the new
 * relative path (leading slash) or null.
 */
export async function resolveBlogRedirect(templateId: string, path: string): Promise<string | null> {
  const redirect = await prisma.blogRedirect.findUnique({
    where: { templateId_fromPath: { templateId, fromPath: normalizeRedirectPath(path) } },
    select: { toPath: true },
  });
  return redirect?.toPath ?? null;
}
