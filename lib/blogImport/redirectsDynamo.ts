import { randomUUID } from "node:crypto";
import { BlogRedirect } from "@/lib/db/contentEntities";
import { normalizeRedirectPath } from "@/lib/blog/redirects";

/**
 * DynamoDB port of lib/blogImport/redirects.ts's createRedirectsForImportedPost — same
 * behavior (see that file's comment). Uses .put(), not .create() — .create() enforces
 * attribute_not_exists (this migration's usual uniqueness pattern) and would throw on a
 * resumed/retried batch re-writing the same fromPath, exactly the case Prisma's upsert
 * was there to handle safely. .put() overwrites unconditionally, matching upsert's
 * create-or-update semantics for real — though unlike Prisma's upsert (which only
 * touches toPath on an existing row), this also mints a fresh id/createdAt on every
 * write. Not a problem in practice: nothing looks up a BlogRedirect by id or relies on
 * its original createdAt surviving a re-import.
 */
export async function createRedirectsForImportedPost(
  templateId: string,
  wpLink: string,
  externalId: number,
  newSlug: string,
): Promise<void> {
  const toPath = `/blog/${newSlug}`;
  const fromPaths = new Set<string>();

  try {
    fromPaths.add(normalizeRedirectPath(new URL(wpLink).pathname));
  } catch {
    // Malformed/relative link from a misconfigured source site — the shortlink below still covers it.
  }
  fromPaths.add(normalizeRedirectPath(`/?p=${externalId}`));

  for (const fromPath of fromPaths) {
    if (fromPath === toPath) continue;
    await BlogRedirect.put({ id: randomUUID(), templateId, fromPath, toPath }).go();
  }
}
