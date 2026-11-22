import { rebuildCustomSections, type CustomSectionType as SdkSectionType, type PageDefinition } from "@charisol/plexo-sdk/v2/compile";

import { CustomSectionType } from "@/lib/db/customSectionEntities";
import { Template } from "@/lib/db/contentEntities";
import { designFormatOf } from "@/lib/v2/design";
import { compileTemplateWithSiteLayout, findRootTemplateId } from "@/lib/siteLayoutCore";
import { newSectionTypeId, type SectionField, type SectionTypeInput } from "./model";
import { STARTER_SECTION_TYPES, starterIdFor } from "./starters";

export type SectionTypeRow = {
  id: string;
  siteId: string;
  name: string;
  description?: string;
  starter?: string;
  fields: SectionField[];
  html: string;
  defaults?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

/** The site a page belongs to — every page of a site shares one list of section types. */
export async function siteIdForTemplate(template: { id: string; parentId?: string | null }): Promise<string> {
  return template.parentId ? findRootTemplateId(template.id, template.parentId) : template.id;
}

function toRow(r: { id: string; siteId: string; name: string; description?: string; starter?: string; fields: unknown; html: string; defaults?: unknown; createdAt?: string; updatedAt?: string }): SectionTypeRow {
  return {
    id: r.id,
    siteId: r.siteId,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    ...(r.starter ? { starter: r.starter } : {}),
    fields: (Array.isArray(r.fields) ? r.fields : []) as SectionField[],
    html: r.html,
    ...(r.defaults && typeof r.defaults === "object" ? { defaults: r.defaults as Record<string, unknown> } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function allRows(siteId: string) {
  const { data } = await CustomSectionType.query.primary({ siteId }).go({ pages: "all" });
  return data;
}

/**
 * Sets up Testimonials and FAQ the first time a site is looked at, so the picker already has something real in it.
 * A starter the owner deleted stays deleted (the row is kept, marked), and the fixed ids make two simultaneous
 * first visits harmless.
 */
export async function ensureStarterSectionTypes(siteId: string, organizationId: string): Promise<void> {
  const rows = await allRows(siteId);
  const have = new Set(rows.map((r) => r.starter).filter(Boolean));
  for (const s of STARTER_SECTION_TYPES) {
    if (have.has(s.starter)) continue;
    try {
      await CustomSectionType.create({ id: starterIdFor(s.starter), siteId, organizationId, name: s.name, description: s.description, starter: s.starter, fields: s.fields, html: s.html, defaults: s.defaults }).go();
    } catch (err) {
      // Someone else just created it — fine. Anything else is worth knowing about, but must not break the editor.
      if (!/conditional|already exists/i.test(String((err as Error)?.message))) console.error("[custom-sections] starter setup failed", err);
    }
  }
}

/** The site's live section types (set up with the starters on first use). */
export async function listSectionTypes(siteId: string, organizationId: string): Promise<SectionTypeRow[]> {
  await ensureStarterSectionTypes(siteId, organizationId);
  const rows = await allRows(siteId);
  return rows
    .filter((r) => !r.deletedAt)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .map(toRow);
}

/** The site's live section types as they are now (no first-time setup — for places that only read). */
export async function listTypesForSite(siteId: string): Promise<SectionTypeRow[]> {
  return (await allRows(siteId)).filter((r) => !r.deletedAt).map(toRow);
}

export async function getSectionType(siteId: string, id: string): Promise<SectionTypeRow | null> {
  const { data } = await CustomSectionType.get({ siteId, id }).go();
  return data && !data.deletedAt ? toRow(data) : null;
}

export async function createSectionType(siteId: string, organizationId: string, input: SectionTypeInput): Promise<SectionTypeRow> {
  const id = newSectionTypeId();
  await CustomSectionType.create({ id, siteId, organizationId, name: input.name, description: input.description, fields: input.fields, html: input.html, defaults: input.defaults }).go();
  const { data } = await CustomSectionType.get({ siteId, id }).go();
  return toRow(data!);
}

export async function updateSectionType(siteId: string, id: string, input: SectionTypeInput): Promise<SectionTypeRow> {
  await CustomSectionType.patch({ siteId, id })
    .set({ name: input.name, description: input.description ?? "", fields: input.fields, html: input.html, defaults: input.defaults })
    .go();
  const { data } = await CustomSectionType.get({ siteId, id }).go();
  return toRow(data!);
}

export async function deleteSectionType(siteId: string, id: string): Promise<void> {
  await CustomSectionType.patch({ siteId, id }).set({ deletedAt: new Date().toISOString() }).go();
}

/** The shape the editor and the compiler take. */
export function toSdkType(row: SectionTypeRow): SdkSectionType {
  return { id: row.id, name: row.name, description: row.description, fields: row.fields as SdkSectionType["fields"], html: row.html, ...(row.defaults ? { defaults: row.defaults } : {}) };
}

type PageRow = { id: string; name: string; kind: string; designFormat?: string | null; designJson: unknown; draftJson?: unknown; parentId?: string | null };

/** Every page of the site (the home page and all pages beneath it). */
async function sitePages(siteId: string): Promise<PageRow[]> {
  const pages: PageRow[] = [];
  const { data: root } = await Template.get({ id: siteId }).go();
  if (root) pages.push(root as PageRow);
  let frontier = [siteId];
  while (frontier.length > 0) {
    const batches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go({ pages: "all" })));
    const children = batches.flatMap((b) => b.data);
    pages.push(...(children as PageRow[]));
    frontier = children.map((c) => c.id);
  }
  return pages.filter((p) => p.kind === "LANDING_PAGE" && designFormatOf(p) === "v2");
}

async function rebuildDesign(raw: unknown, types: SdkSectionType[]): Promise<{ design: unknown; changed: number } | null> {
  if (!raw || typeof raw !== "object") return null;
  const original = raw as { pages?: PageDefinition[] };
  if (!Array.isArray(original.pages)) return null;
  const out = rebuildCustomSections(original.pages, types);
  return out.changed > 0 ? { design: { ...original, pages: out.pages }, changed: out.changed } : null;
}

/**
 * "Change the design once, it updates everywhere": after a section type's design or fields change, every page of the site
 * that uses it is redrawn from its own saved content, then rebuilt for visitors. Each page keeps its own words.
 * Returns how many pages changed. A page that can't be rebuilt is skipped (it keeps its last good version).
 */
export async function applySectionTypeToPages(siteId: string, types: SectionTypeRow[]): Promise<number> {
  const sdkTypes = types.map(toSdkType);
  let touched = 0;
  for (const page of await sitePages(siteId)) {
    try {
      const live = await rebuildDesign(page.designJson, sdkTypes);
      const draft = page.draftJson ? await rebuildDesign(page.draftJson, sdkTypes) : null;
      if (!live && !draft) continue;
      const patch: Record<string, unknown> = {};
      if (live) {
        patch.designJson = live.design;
        patch.compiledHtml = await compileTemplateWithSiteLayout(page as never, live.design);
      }
      if (draft) {
        patch.draftJson = draft.design;
        patch.draftHtml = await compileTemplateWithSiteLayout(page as never, draft.design);
      }
      await Template.patch({ id: page.id }).set(patch).go();
      touched++;
    } catch (err) {
      console.error(`[custom-sections] couldn't rebuild page ${page.id}`, err);
    }
  }
  return touched;
}
