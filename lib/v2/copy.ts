import { Template } from "@/lib/db/contentEntities";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutCore";
import { designFormatOf } from "@/lib/v2/design";

/**
 * A copied new-editor (V2) page can't reuse its source's compiledHtml: that HTML's forms
 * post to the SOURCE site's id. Call this after creating the copy (all rows of a copied
 * site exist first, so the root chain resolves) to rebuild it for its own place.
 * No-op for classic pages, whose compiled HTML carries no site ids.
 */
export async function recompileCopiedV2Page(id: string): Promise<void> {
  const { data: row } = await Template.get({ id }).go();
  if (!row || designFormatOf(row) !== "v2" || row.kind !== "LANDING_PAGE" || row.sourceType !== "BUILDER") return;
  try {
    const compiledHtml = await compileTemplateWithSiteLayout(row);
    await Template.patch({ id }).set({ compiledHtml }).go();
  } catch (err) {
    console.error(`Could not rebuild copied page ${id} (kept the source's HTML):`, err);
  }
}
