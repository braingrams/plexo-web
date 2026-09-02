import { BlogRedirect } from "@/lib/db/contentEntities";
import { normalizeRedirectPath } from "./redirects";

/**
 * DynamoDB port of lib/blog/redirects.ts's resolveBlogRedirect — same contract (see that
 * file's own comment). normalizeRedirectPath is pure (no Prisma dependency) and re-exported
 * from the original rather than duplicated, same pattern server/slugDynamo.ts uses for
 * slugify/isValidUuid.
 */
export { normalizeRedirectPath };

/** fromPath is BlogRedirect's own sort key (see contentEntities.ts) — an O(1) .get(), not a scan. */
export async function resolveBlogRedirect(templateId: string, path: string): Promise<string | null> {
  const { data } = await BlogRedirect.get({ templateId, fromPath: normalizeRedirectPath(path) }).go();
  return data?.toPath ?? null;
}
