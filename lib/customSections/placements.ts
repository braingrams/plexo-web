import { customKindOf, richTextToPlain } from "@charisol/plexo-sdk/v2/compile";

import { CustomSectionPageMarker, CustomSectionPlacement } from "@/lib/db/customSectionEntities";
import { Template } from "@/lib/db/contentEntities";
import { designFormatOf } from "@/lib/v2/design";
import { pathForPage } from "@/server/slugDynamo";
import { listSectionTypes, siteIdForTemplate, type SectionTypeRow } from "./service";
import type { SectionField } from "./model";

// "Entries": every place a section type is used across the site's pages. The answer comes from an index kept in step with
// the pages (see CustomSectionPlacement), not from reading every page's design each time someone asks.
//
//  - Saving a page (editor, AI tools, a section-type redesign, restoring a version…) calls `syncPageEntries`, which reads
//    just that page and rewrites its rows.
//  - Listing calls `siteEntries`, which first checks the (small) page list against the markers and re-reads only pages that
//    changed since they were indexed, forgets pages that are gone, and backfills sites that were never indexed. So the
//    index also repairs itself after anything that changed a page without telling it (duplicating, importing, old versions).

export type EntryRow = {
  typeId: string;
  pageId: string;
  sectionId: string;
  pageTitle: string;
  /** Public address of the page ("/" for the home page). */
  pagePath: string;
  keyText: string;
  rows: number | null;
  draft: boolean;
  editedAt: string;
};

type Block = { kind?: string; content?: Record<string, unknown> };
type DesignNode = { id?: string; type?: string; props?: { block?: Block }; children?: DesignNode[] };

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plain = (v: unknown, rich: boolean): string => (typeof v === "string" ? (rich ? richTextToPlain(v) : v.replace(/\s+/g, " ").trim()) : "");

/** The words that identify one use: its first filled-in heading/name, else the first one in its first repeated row. */
export function keyTextOf(fields: SectionField[], content: Record<string, unknown>): string {
  const textual = (f: SectionField) => f.type === "text" || f.type === "longtext" || f.type === "richtext";
  for (const f of fields) {
    if (!textual(f)) continue;
    const t = plain(content[f.key], f.type === "richtext");
    if (t) return clip(t);
  }
  for (const f of fields) {
    if (f.type !== "list" || !Array.isArray(content[f.key])) continue;
    const first = (content[f.key] as Array<Record<string, unknown>>)[0];
    if (!first || typeof first !== "object") continue;
    for (const inner of f.item ?? []) {
      if (!textual(inner)) continue;
      const t = plain(first[inner.key], inner.type === "richtext");
      if (t) return clip(t);
    }
  }
  return "";
}

export function rowCountOf(fields: SectionField[], content: Record<string, unknown>): number | null {
  const list = fields.find((f) => f.type === "list");
  if (!list) return null;
  const v = content[list.key];
  return Array.isArray(v) ? v.length : 0;
}

type Found = { typeId: string; sectionId: string; keyText: string; rows: number | null };

/** Every use of a custom section type in a design (any depth, any of its pages). Pure. */
export function findUses(design: unknown, typesByKind: Map<string, SectionTypeRow>): Found[] {
  const out: Found[] = [];
  const pages = design && typeof design === "object" && Array.isArray((design as { pages?: unknown }).pages) ? ((design as { pages: Array<{ rootNode?: DesignNode }> }).pages) : [];
  const walk = (node: DesignNode | undefined, depth: number) => {
    if (!node || depth > 60) return;
    const block = node.type === "section" ? node.props?.block : undefined;
    if (block && typeof block.kind === "string" && node.id) {
      const type = typesByKind.get(block.kind);
      if (type) {
        const content = block.content && typeof block.content === "object" ? block.content : {};
        out.push({ typeId: type.id, sectionId: node.id, keyText: keyTextOf(type.fields, content), rows: rowCountOf(type.fields, content) });
      }
    }
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  for (const p of pages) walk(p.rootNode, 0);
  return out;
}

export const typesByKindOf = (types: SectionTypeRow[]): Map<string, SectionTypeRow> => new Map(types.map((t) => [customKindOf(t.id), t]));
/** A short fingerprint of the site's section types: when a type's fields change, every page is re-read once. */
export const typesStampOf = (types: SectionTypeRow[]): string => types.map((t) => `${t.id}:${t.updatedAt ?? ""}`).sort().join("|").slice(0, 900);

type PageLike = { id: string; name: string; updatedAt?: string; draftJson?: unknown; designJson?: unknown; designFormat?: string | null };

/** Re-reads one page and rewrites its rows in the index (and drops rows for sections that are gone). */
async function indexPage(siteId: string, organizationId: string, page: PageLike, types: SectionTypeRow[]): Promise<void> {
  const stamp = page.updatedAt ?? new Date().toISOString();
  const hasDraft = page.draftJson != null;
  const found = designFormatOf(page) === "v2" ? findUses(page.draftJson ?? page.designJson, typesByKindOf(types)) : [];

  const { data: marker } = await CustomSectionPageMarker.get({ siteId, pageId: page.id }).go();
  const old = (Array.isArray(marker?.keys) ? marker!.keys : []) as Array<[string, string]>;
  const now = new Set(found.map((f) => `${f.typeId}\u0000${f.sectionId}`));
  const gone = old.filter(([t, s]) => !now.has(`${t}\u0000${s}`));

  if (gone.length) await CustomSectionPlacement.delete(gone.map(([typeId, sectionId]) => ({ siteId, typeId, pageId: page.id, sectionId }))).go();
  if (found.length) {
    await CustomSectionPlacement.put(
      found.map((f) => ({ siteId, organizationId, typeId: f.typeId, pageId: page.id, sectionId: f.sectionId, pageTitle: page.name, ...(f.keyText ? { keyText: f.keyText } : {}), ...(f.rows !== null ? { rows: f.rows } : {}), draft: hasDraft, editedAt: stamp })),
    ).go();
  }
  await CustomSectionPageMarker.put({ siteId, pageId: page.id, stamp, typesStamp: typesStampOf(types), keys: found.map((f) => [f.typeId, f.sectionId]) }).go();
}

/** Call after a page was saved or changed: brings that page's rows up to date. Never throws — a hiccup here must not fail the save (the next listing repairs it). */
export async function syncPageEntries(pageId: string): Promise<void> {
  try {
    const { data: page } = await Template.get({ id: pageId }).go();
    if (!page || page.kind !== "LANDING_PAGE" || !page.organizationId) return;
    const siteId = await siteIdForTemplate(page);
    const types = await listSectionTypes(siteId, page.organizationId);
    await indexPage(siteId, page.organizationId, page as PageLike, types);
  } catch (err) {
    console.error(`[custom-sections] couldn't update the entries index for page ${pageId}`, err);
  }
}

/** Call when pages are deleted: forgets their rows. Never throws. */
export async function forgetPageEntries(siteId: string, pageIds: string[]): Promise<void> {
  try {
    for (const pageId of pageIds) {
      const { data: marker } = await CustomSectionPageMarker.get({ siteId, pageId }).go();
      if (!marker) continue;
      const keys = (Array.isArray(marker.keys) ? marker.keys : []) as Array<[string, string]>;
      if (keys.length) await CustomSectionPlacement.delete(keys.map(([typeId, sectionId]) => ({ siteId, typeId, pageId, sectionId }))).go();
      await CustomSectionPageMarker.delete({ siteId, pageId }).go();
    }
  } catch (err) {
    console.error("[custom-sections] couldn't clear entries for deleted pages", err);
  }
}

/** Removes everything the index holds for a site (when the whole site is deleted). */
export async function forgetSiteEntries(siteId: string): Promise<void> {
  try {
    const [{ data: rows }, { data: marks }] = await Promise.all([CustomSectionPlacement.query.primary({ siteId }).go({ pages: "all" }), CustomSectionPageMarker.query.primary({ siteId }).go({ pages: "all" })]);
    if (rows.length) await CustomSectionPlacement.delete(rows.map((r) => ({ siteId, typeId: r.typeId, pageId: r.pageId, sectionId: r.sectionId }))).go();
    if (marks.length) await CustomSectionPageMarker.delete(marks.map((m) => ({ siteId, pageId: m.pageId }))).go();
  } catch (err) {
    console.error("[custom-sections] couldn't clear a deleted site's entries", err);
  }
}

type TreePage = { id: string; name: string; parentId?: string | null; slug?: string | null; updatedAt?: string; kind: string };
const TREE_ATTRS = ["id", "name", "parentId", "slug", "updatedAt", "kind", "organizationId"] as const;

/** The site's pages, light (no designs). */
async function siteTree(siteId: string): Promise<TreePage[]> {
  const pages: TreePage[] = [];
  const { data: root } = await Template.get({ id: siteId }).go({ attributes: [...TREE_ATTRS] });
  if (root) pages.push(root as TreePage);
  let frontier = [siteId];
  while (frontier.length > 0) {
    const batches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go({ pages: "all", attributes: [...TREE_ATTRS] })));
    const children = batches.flatMap((b) => b.data) as TreePage[];
    pages.push(...children);
    frontier = children.map((c) => c.id);
  }
  return pages;
}

/**
 * Brings the whole site's index up to date (re-reading only what changed) and returns every use of every section type.
 * `types` is passed in so the caller's own list isn't fetched twice.
 */
export async function siteEntries(siteId: string, organizationId: string, types: SectionTypeRow[]): Promise<EntryRow[]> {
  const [tree, markers] = await Promise.all([siteTree(siteId), CustomSectionPageMarker.query.primary({ siteId }).go({ pages: "all" }).then((r) => r.data)]);
  const pages = tree.filter((p) => p.kind === "LANDING_PAGE");
  const markerOf = new Map(markers.map((m) => [m.pageId, m]));
  const typesStamp = typesStampOf(types);

  const stale = pages.filter((p) => {
    const m = markerOf.get(p.id);
    return !m || m.stamp !== (p.updatedAt ?? "") || m.typesStamp !== typesStamp;
  });
  // Re-read changed pages a few at a time (the first listing of an older site does the whole backfill here).
  for (let i = 0; i < stale.length; i += 6) {
    await Promise.all(
      stale.slice(i, i + 6).map(async (p) => {
        const { data: full } = await Template.get({ id: p.id }).go();
        if (full) await indexPage(siteId, organizationId, full as PageLike, types).catch((err) => console.error(`[custom-sections] couldn't index page ${p.id}`, err));
      }),
    );
  }
  const alive = new Set(pages.map((p) => p.id));
  const orphans = markers.filter((m) => !alive.has(m.pageId)).map((m) => m.pageId);
  if (orphans.length) await forgetPageEntries(siteId, orphans);

  const { data: rows } = await CustomSectionPlacement.query.primary({ siteId }).go({ pages: "all" });
  const live = new Set(types.map((t) => t.id));
  const treeNodes = tree.map((p) => ({ id: p.id, parentId: p.parentId ?? null, slug: p.slug ?? null }));
  const titleOf = new Map(pages.map((p) => [p.id, p.name]));
  return rows
    .filter((r) => live.has(r.typeId) && alive.has(r.pageId))
    .map((r) => ({
      typeId: r.typeId,
      pageId: r.pageId,
      sectionId: r.sectionId,
      pageTitle: titleOf.get(r.pageId) ?? r.pageTitle,
      pagePath: pathForPage(r.pageId, treeNodes as never),
      keyText: r.keyText ?? "",
      rows: typeof r.rows === "number" ? r.rows : null,
      draft: !!r.draft,
      editedAt: r.editedAt,
    }));
}
