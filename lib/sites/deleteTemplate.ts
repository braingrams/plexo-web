import { Template, TemplateAsset, PublishedDomain } from "@/lib/db/contentEntities";
import { deleteObjects } from "@/lib/storage";
import { removeCloudFrontDomain } from "@/lib/cloudfrontDomains";
import { getDescendantIds } from "@/server/slugDynamo";
import { purgeSiteData, siteDeletionBlocker, siteLayoutTemplateIds } from "./purgeSiteData";
import { dropAppDatabases, purgeAppProject } from "@/lib/projects/purgeApp";

// The one way a page or site is deleted — shared by the dashboard route
// (app/api/templates/[id]), the v1 API and the MCP delete_template tool, so they can't
// drift apart. A page takes its sub-pages, files and domains with it; a whole site also
// takes everything it owns (lib/sites/purgeSiteData.ts).

/** Shown to the person deleting, as is. */
export class SiteDeletionBlockedError extends Error {}

export async function deleteTemplateAndContents(existing: { id: string; parentId?: string | null }, organizationId: string): Promise<{ descendantCount: number; removedData: number }> {
  const { data: full } = await Template.get({ id: existing.id }).go();
  const flags = (full ?? {}) as { isBlogLayout?: boolean; isCommerceLayout?: boolean };
  const isSite = !existing.parentId && !flags.isBlogLayout && !flags.isCommerceLayout;
  if (isSite) {
    const blocker = await siteDeletionBlocker(existing.id);
    if (blocker) throw new SiteDeletionBlockedError(blocker);
  }

  // An app's databases first: if they can't be removed, stop before anything else is.
  if (isSite && full?.sourceType === "REACT_PROJECT") {
    try {
      await dropAppDatabases(existing.id);
    } catch (err) {
      throw new SiteDeletionBlockedError((err as Error).message);
    }
  }

  const descendantIds = await getDescendantIds(organizationId, existing.id);
  // The site's blog and product layouts sit outside its page tree — they go with it (same organization only).
  const layoutIds = isSite
    ? (
        await Promise.all(
          (await siteLayoutTemplateIds(existing.id)).map(async (id) => ((await Template.get({ id }).go()).data?.organizationId === organizationId ? id : null)),
        )
      ).filter((id): id is string => id !== null)
    : [];
  const otherIds = [...descendantIds, ...layoutIds];
  const allIds = [existing.id, ...otherIds];

  // Files: storage first, then their rows.
  const assets = (await Promise.all(allIds.map((tid) => TemplateAsset.query.primary({ templateId: tid }).go({ pages: "all" })))).flatMap((b) => b.data);
  if (assets.length > 0) {
    await deleteObjects(assets.map((a) => a.blobUrl)).catch((err) => console.error("Failed to delete files during delete (non-fatal):", err));
  }
  await Promise.all(assets.map((a) => TemplateAsset.remove({ templateId: a.templateId, path: a.path }).go()));

  // Domains: a custom domain's CloudFront tenant first, then the rows.
  const domains = (await Promise.all(allIds.map((tid) => PublishedDomain.query.primary({ templateId: tid }).go({ pages: "all" })))).flatMap((b) => b.data);
  for (const d of domains) {
    if (d.type === "CUSTOM") {
      await removeCloudFrontDomain(d.domain, { tenantId: d.tenantId, certificateArn: d.certificateArn }).catch((err) =>
        console.error(`Failed to remove CloudFront distribution tenant for ${d.domain} during delete (non-fatal):`, err),
      );
    }
  }
  await Promise.all(domains.map((d) => PublishedDomain.remove({ templateId: d.templateId, id: d.id }).go()));

  // A React app also owns a database, server functions, builds and stored files.
  if (isSite && full?.sourceType === "REACT_PROJECT") await purgeAppProject(existing.id);
  const { removed } = isSite ? await purgeSiteData(existing.id, otherIds) : { removed: 0 };

  await Promise.all(otherIds.map((id) => Template.remove({ id }).go()));
  await Template.remove({ id: existing.id }).go();
  return { descendantCount: descendantIds.length, removedData: removed };
}
