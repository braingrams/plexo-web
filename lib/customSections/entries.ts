import { customKindOf } from "@charisol/plexo-sdk/v2/compile";

import { Template } from "@/lib/db/contentEntities";
import { applyToDesign, currentDesign, PageToolError, validateAndCompile } from "@/lib/mcp/v2Pages";
import { externalizeDesignSystem, resolveDesignSystem } from "@/lib/v2/designSystemStore";
import { parseV2Design, designFormatOf } from "@/lib/v2/design";
import { registerSiteSections } from "./register";
import { getSectionType, listTypesForSite, siteIdForTemplate, type SectionTypeRow } from "./service";
import { syncPageEntries } from "./placements";
import type { SectionField } from "./model";
import { contentPatch } from "./contentPatch";

// Looking at, and changing, one use of a section type without opening the page editor. A change goes through the same
// commands the editor and the AI tools use (so the content is checked against the section's fields and the section is
// rebuilt from its design), is compiled with the site's header and footer, and lands where visitors will see it.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Content = Record<string, unknown>;
type Block = { kind?: string; content?: Content };
type Node = { id?: string; type?: string; props?: { block?: Block }; children?: Node[] };

/** A page that belongs to this site, or an error in plain words. */
async function pageOfSite(siteId: string, organizationId: string, pageId: string): Promise<Row> {
  const { data: page } = await Template.get({ id: pageId }).go();
  if (!page || page.organizationId !== organizationId || page.kind !== "LANDING_PAGE" || (await siteIdForTemplate(page)) !== siteId) {
    throw new PageToolError("We couldn't find that page on this site. It may have been deleted.");
  }
  if (designFormatOf(page) !== "v2") throw new PageToolError(`"${page.name}" was made in the classic editor, so its sections can only be changed there.`);
  return page;
}

function findBlock(design: unknown, sectionId: string): Block | null {
  const pages = design && typeof design === "object" && Array.isArray((design as { pages?: unknown }).pages) ? (design as { pages: Array<{ rootNode?: Node }> }).pages : [];
  let hit: Block | null = null;
  const walk = (n: Node | undefined, depth: number) => {
    if (!n || hit || depth > 60) return;
    if (n.type === "section" && n.id === sectionId && n.props?.block) hit = n.props.block;
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  for (const p of pages) walk(p.rootNode, 0);
  return hit;
}

export type EntryDetail = { pageId: string; pageTitle: string; sectionId: string; type: SectionTypeRow; content: Content; draft: boolean };

/** The words in one use, as the fill-in form needs them (the working copy when the page has one). */
export async function getEntry(siteId: string, organizationId: string, pageId: string, sectionId: string): Promise<EntryDetail> {
  const page = await pageOfSite(siteId, organizationId, pageId);
  const draft = page.draftJson != null;
  const block = findBlock(draft ? page.draftJson : page.designJson, sectionId) ?? (draft ? findBlock(page.designJson, sectionId) : null);
  if (!block || typeof block.kind !== "string") throw new PageToolError("That section isn't on the page any more.");
  const typeId = await typeIdOfKind(siteId, block.kind);
  if (!typeId) throw new PageToolError("That section's design has been removed, so it can't be edited here.");
  const type = (await getSectionType(siteId, typeId))!;
  return { pageId, pageTitle: page.name, sectionId, type, content: block.content ?? {}, draft };
}

async function typeIdOfKind(siteId: string, kind: string): Promise<string | null> {
  const rows = await listTypesForSite(siteId);
  return rows.find((t) => customKindOf(t.id) === kind)?.id ?? null;
}

/** Applies a change to one design (live or working copy) of the page and saves it. Returns false when that design doesn't have the section. */
async function applyTo(page: Row, which: "live" | "draft", sectionId: string, content: Content): Promise<boolean> {
  const raw = which === "draft" ? page.draftJson : page.designJson;
  if (!raw || !findBlock(raw, sectionId)) return false;
  const parsed = parseV2Design(await resolveDesignSystem(raw));
  if (!parsed.ok) throw new PageToolError(`We couldn't read "${page.name}" to change it (${parsed.error}). Open it in the page editor to check it.`);
  const applied = applyToDesign(parsed.design, [{ op: "updateSection", sectionId, content }]);
  if (!applied.anyOk) throw new PageToolError(applied.results.find((r) => !r.ok)?.message ?? "That change couldn't be saved.");
  const checked = await validateAndCompile(page, applied.design);
  const stored = await externalizeDesignSystem(checked.design);
  if (which === "draft") await Template.patch({ id: page.id }).set({ draftJson: stored, draftHtml: checked.html }).go();
  else await Template.patch({ id: page.id }).set({ designJson: stored, compiledHtml: checked.html }).go();
  return true;
}

/**
 * Saves new words for one use. The change goes live straight away; if the page also has changes waiting to be published,
 * those stay waiting and only this section's words are updated in the working copy too.
 */
export async function updateEntry(siteId: string, organizationId: string, pageId: string, sectionId: string, newContent: Content): Promise<{ published: boolean; hasWaitingChanges: boolean }> {
  const page = await pageOfSite(siteId, organizationId, pageId);
  await registerSiteSections(siteId, organizationId);
  const current = await getEntry(siteId, organizationId, pageId, sectionId);
  const patch = contentPatch(current.type.fields, current.content, newContent);
  if (Object.keys(patch).length === 0) return { published: true, hasWaitingChanges: page.draftJson != null };
  const hasDraft = page.draftJson != null;
  const live = await applyTo(page, "live", sectionId, patch);
  const fresh = hasDraft ? (await Template.get({ id: pageId }).go()).data ?? page : page;
  const draft = hasDraft ? await applyTo(fresh, "draft", sectionId, patch) : false;
  if (!live && !draft) throw new PageToolError("That section isn't on the page any more.");
  await syncPageEntries(pageId);
  return { published: live, hasWaitingChanges: hasDraft };
}

/** Removes uses of a section from their pages (a bulk "take these off"). Live and working copy both. Returns how many were removed. */
export async function removeEntries(siteId: string, organizationId: string, items: Array<{ pageId: string; sectionId: string }>): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  const byPage = new Map<string, string[]>();
  for (const it of items.slice(0, 200)) byPage.set(it.pageId, [...(byPage.get(it.pageId) ?? []), it.sectionId]);
  await registerSiteSections(siteId, organizationId);
  for (const [pageId, sectionIds] of byPage) {
    try {
      let page = await pageOfSite(siteId, organizationId, pageId);
      for (const which of ["live", "draft"] as const) {
        const raw = which === "draft" ? page.draftJson : page.designJson;
        if (!raw) continue;
        const ids = sectionIds.filter((id) => findBlock(raw, id));
        if (!ids.length) continue;
        const parsed = parseV2Design(await resolveDesignSystem(raw));
        if (!parsed.ok) throw new PageToolError(parsed.error);
        const applied = applyToDesign(parsed.design, ids.map((sectionId) => ({ op: "removeSection", sectionId })));
        if (!applied.anyOk) continue;
        const checked = await validateAndCompile(page, applied.design);
        const stored = await externalizeDesignSystem(checked.design);
        if (which === "draft") await Template.patch({ id: pageId }).set({ draftJson: stored, draftHtml: checked.html }).go();
        else await Template.patch({ id: pageId }).set({ designJson: stored, compiledHtml: checked.html }).go();
        page = (await Template.get({ id: pageId }).go()).data ?? page;
      }
      removed += sectionIds.length;
      await syncPageEntries(pageId);
    } catch (err) {
      console.error(`[custom-sections] couldn't remove sections from page ${pageId}`, err);
      failed += sectionIds.length;
    }
  }
  return { removed, failed };
}

export { currentDesign };
