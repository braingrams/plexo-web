import { randomUUID } from "node:crypto";
import { Template, TemplateAsset } from "@/lib/db/contentEntities";
import { uploadObject, deleteObjects } from "@/lib/storage";
import { extensionOf, humanizePageFilename } from "@/server/rawUpload";
import { slugify } from "@/lib/slugUtils";

// A raw-upload site is a set of pages. When extra .html files sit beside index.html (a zip upload,
// a re-upload, or a file added in the editor), each one becomes a real Plexo page — counted as a
// page of the site, listed in the dashboard, editable, with its own address — instead of staying a
// loose file that happens to be served. Same address as before (about.html is /about), and the
// old .html address redirects to it (see the public route), so no link breaks.

export type SplitPage = { id: string; name: string; slug: string };
export type SplitResult = { created: SplitPage[]; updated: SplitPage[]; skipped: string[] };

type SiteRoot = { id: string; userId: string; organizationId: string; sourceType?: string | null; parentId?: string | null; kind?: string | null };

const isPageFile = (path: string) => !path.includes("/") && ["html", "htm"].includes(extensionOf(path)) && !/^index\.html?$/i.test(path);

/** "About Us | Serenity Pas" → "About Us"; falls back to the file name ("about-us.html" → "About Us"). */
export function pageNameFromHtml(html: string, filename: string): string {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.replace(/&amp;/g, "&").trim();
  const first = title?.split(/\s+[|–—\-]\s+/)[0]?.trim();
  return (first || humanizePageFilename(filename)).slice(0, 100);
}

export const pageSlugFromFilename = (filename: string): string => slugify(filename.replace(/\.(html?|htm)$/i, "")) || "page";

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Does this raw site have loose .html files that should be pages? (Cheap check for UIs and callers.) */
export async function listLoosePages(rootId: string): Promise<string[]> {
  const { data: assets } = await TemplateAsset.query.primary({ templateId: rootId }).go({ pages: "all", attributes: ["path"] });
  return assets.map((a) => a.path).filter(isPageFile);
}

/**
 * Turns every loose root-level .html/.htm file of a raw-upload site into a page. Safe to run
 * again: a page that already exists at that address is updated with the file's content, not
 * duplicated. Callers decide whether the owner's plan allows several pages (multiPageSitesEnabled);
 * without it the files stay as they are.
 */
export async function splitHtmlAssetsIntoPages(root: SiteRoot): Promise<SplitResult> {
  const result: SplitResult = { created: [], updated: [], skipped: [] };
  if (root.sourceType !== "RAW_UPLOAD" || root.parentId || (root.kind && root.kind !== "LANDING_PAGE")) return result;

  const { data: assets } = await TemplateAsset.query.primary({ templateId: root.id }).go({ pages: "all" });
  const pageAssets = assets.filter((a) => isPageFile(a.path));
  if (pageAssets.length === 0) return result;
  const shared = assets.filter((a) => !isPageFile(a.path));

  // Downloaded once, then copied for each page (each page keeps its own copy of the shared css/js/images,
  // like a page created by a zip upload does — files are stored per page).
  const sharedBuffers = await Promise.all(shared.map(async (a) => ({ asset: a, buffer: await download(a.blobUrl) })));

  const { data: siblings } = await Template.query.byParent({ parentId: root.id }).go({ pages: "all" });
  let nextOrder = siblings.reduce((m, s) => Math.max(m, s.order ?? 0), -1) + 1;
  const doneBlobs: string[] = [];

  for (const pageAsset of pageAssets) {
    try {
      const html = (await download(pageAsset.blobUrl)).toString("utf8");
      const name = pageNameFromHtml(html, pageAsset.path);
      const slug = pageSlugFromFilename(pageAsset.path);
      const existing = siblings.find((s) => s.slug === slug);
      if (existing) {
        if (existing.sourceType !== "RAW_UPLOAD") {
          result.skipped.push(`${pageAsset.path} (a ${existing.sourceType === "BUILDER" ? "designed" : "different"} page already uses /${slug})`);
          continue;
        }
        await Template.patch({ id: existing.id }).set({ compiledHtml: html }).go();
        result.updated.push({ id: existing.id, name: existing.name, slug });
      } else {
        const childId = randomUUID();
        const uploaded = await Promise.all(sharedBuffers.map(async ({ asset, buffer }) => {
          const blob = await uploadObject(`raw-sites/${childId}/${asset.path}`, buffer, { access: "public", contentType: asset.contentType });
          return { templateId: childId, path: asset.path, blobUrl: blob.url, contentType: asset.contentType, size: buffer.byteLength };
        }));
        await Template.create({
          id: childId,
          userId: root.userId,
          organizationId: root.organizationId,
          name,
          kind: "LANDING_PAGE",
          sourceType: "RAW_UPLOAD",
          designJson: {},
          compiledHtml: html,
          parentId: root.id,
          slug,
          order: nextOrder++,
        }).go();
        if (uploaded.length > 0) await Promise.all(uploaded.map((a) => TemplateAsset.create({ id: randomUUID(), ...a }).go()));
        result.created.push({ id: childId, name, slug });
      }
      // The file is now a page; remove the loose copy so there is one source of truth.
      await TemplateAsset.remove({ templateId: root.id, path: pageAsset.path }).go();
      doneBlobs.push(pageAsset.blobUrl);
    } catch (err) {
      console.error(`[raw-site] could not turn "${pageAsset.path}" into a page:`, err);
      result.skipped.push(`${pageAsset.path} (${err instanceof Error ? err.message : "failed"})`);
    }
  }
  if (doneBlobs.length > 0) await deleteObjects(doneBlobs).catch((e) => console.error("[raw-site] stale blob cleanup failed (non-fatal):", e));
  return result;
}
