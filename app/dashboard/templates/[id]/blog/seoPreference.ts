// The writer's choice to show or hide the SEO tools (search preview, meta fields, checklist).
// Stored per browser. Anything other than an explicit "off" means on, so existing writers see no change.

export const SEO_TOOLS_STORAGE_KEY = "plexo.blogEditor.seoTools";

export function seoToolsEnabledFrom(stored: string | null | undefined): boolean {
  return stored !== "off";
}
