import { prisma } from "@/server/prisma";
import { normalizeRedirectPath } from "@/lib/blog/redirects";

/**
 * Stores the imported post's OLD path(s) — whatever permalink structure the source site
 * used, taken verbatim from the REST API's `link` field, plus WordPress's always-working
 * numeric shortlink (/?p=123) — pointing at its new /blog/[slug] home. Exact paths, not
 * an inferred permalink-structure regex: simpler and safer given custom/mixed structures.
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
    await prisma.blogRedirect.upsert({
      where: { templateId_fromPath: { templateId, fromPath } },
      create: { templateId, fromPath, toPath },
      update: { toPath },
    });
  }
}
