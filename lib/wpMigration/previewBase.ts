import { PublishedDomain, Template } from "@/lib/db/contentEntities";

// A migrated WordPress page references its theme/plugin files and media by root-relative
// URL (/lineagecare/wp-content/…), stored on whichever page of the site tree owns that path
// (see urlSpace.ts) — not on the page being edited. The editor's previews render the page's
// HTML in an iframe with no URL of its own, so those references resolved against the
// DASHBOARD's host and every stylesheet, script and image 404'd: the preview looked broken
// even though the published page is fine. Pointing the preview's <base> at the page's live
// address makes every reference load exactly what visitors get.

/** The live URL of a migrated page (directory-style, so relative refs resolve as on WordPress), or null. */
export async function migratedPreviewBase(template: { id: string; parentId?: string | null; slug?: string | null; migratedFrom?: string | null }): Promise<string | null> {
  if (!template.migratedFrom) return null;
  const segments: string[] = [];
  let cursor: { id: string; parentId?: string | null; slug?: string | null } | null = template;
  for (let depth = 0; cursor?.parentId && depth < 32; depth++) {
    if (cursor.slug) segments.unshift(cursor.slug);
    const { data: parent }: { data: { id: string; parentId?: string | null; slug?: string | null } | null } = await Template.get({ id: cursor.parentId }).go();
    cursor = parent;
  }
  if (!cursor) return null;
  const { data: domains } = await PublishedDomain.query.primary({ templateId: cursor.id }).go();
  const domain = domains[0]?.domain;
  if (!domain) return null;
  const path = segments.map(encodeURIComponent).join("/");
  return `https://${domain}/${path ? `${path}/` : ""}`;
}

export { injectBaseHref } from "./injectBaseHref";
