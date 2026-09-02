import { BlogRedirect } from "@/lib/db/contentEntities";

/**
 * Canonical form BlogRedirect.fromPath/toPath are always stored and looked up in
 * (leading slash, no trailing slash) — used both when the WordPress importer writes a
 * redirect row and here when reading it back, so the two never drift out of sync.
 */
export function normalizeRedirectPath(path: string): string {
  return "/" + path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** fromPath is BlogRedirect's own sort key (see contentEntities.ts) — an O(1) .get(), not a scan. */
export async function resolveBlogRedirect(templateId: string, path: string): Promise<string | null> {
  const { data } = await BlogRedirect.get({ templateId, fromPath: normalizeRedirectPath(path) }).go();
  return data?.toPath ?? null;
}
