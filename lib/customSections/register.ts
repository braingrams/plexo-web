import { registerCustomSections } from "@charisol/plexo-sdk/v2/compile";
import { listSectionTypes, siteIdForTemplate, toSdkType } from "./service";

/** Makes a site's own section types known to the page builder before it adds or changes one (the AI tools use this). */
export async function registerSiteSections(siteId: string, organizationId: string): Promise<void> {
  registerCustomSections((await listSectionTypes(siteId, organizationId)).map(toSdkType));
}

/** Same, starting from a page row. Never fails the edit: without the types, only edits to those sections are refused. */
export async function registerSectionsForRow(row: { id: string; parentId?: string | null; organizationId?: string }): Promise<void> {
  try {
    if (!row.organizationId) return;
    await registerSiteSections(await siteIdForTemplate(row), row.organizationId);
  } catch (err) {
    console.error("[custom-sections] couldn't load section types for an edit", err);
  }
}
