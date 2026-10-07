import { PublishedDomain, Template } from "@/lib/db/contentEntities";

// A migrated WordPress page references its theme/plugin files and media by root-relative
// URL (/lineagecare/wp-content/…), stored on whichever page of the site tree owns that path
// (see urlSpace.ts) — not on the page being edited. The editor's previews render the page's
// HTML in an iframe with no URL of its own, so those references resolved against the
// DASHBOARD's host and every stylesheet, script and image 404'd: the preview looked broken
// even though the published page is fine. Pointing the preview's <base> at the page's live
// address makes every reference load exactly what visitors get.

type TreeNode = { id: string; parentId?: string | null; slug?: string | null; migratedFrom?: string | null };

/** The live URL of a migrated page (directory-style, so relative refs resolve as on WordPress), or null. */
export async function migratedPreviewBase(template: TreeNode): Promise<string | null> {
  // Walk up to the site's root first: the "moved from WordPress" marker is reliably on the
  // root, not on every page under it — checking only the page being edited missed every
  // sub-page (i.e. nearly all of a migrated site).
  const segments: string[] = [];
  let migrated = Boolean(template.migratedFrom);
  let cursor: TreeNode | null = template;
  for (let depth = 0; cursor?.parentId && depth < 32; depth++) {
    if (cursor.slug) segments.unshift(cursor.slug);
    const { data: parent }: { data: TreeNode | null } = await Template.get({ id: cursor.parentId }).go();
    cursor = parent;
    if (cursor?.migratedFrom) migrated = true;
  }
  if (!cursor || !migrated) return null;
  const { data: domains } = await PublishedDomain.query.primary({ templateId: cursor.id }).go();
  const domain = domains[0]?.domain;
  if (!domain) return null;
  const path = segments.map(encodeURIComponent).join("/");
  return `https://${domain}/${path ? `${path}/` : ""}`;
}

export { injectBaseHref } from "./injectBaseHref";
