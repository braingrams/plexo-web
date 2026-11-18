/**
 * The visual editor's brand-component commands (page_edit, SOL's page tools). They are part of the SDK since 2.0.33, so the flag below is on;
 * flip it off to fall back to the plain explanations if a release ever has to be pinned back.
 *
 * The command layer lives in @charisol/plexo-sdk (applyCommands), not in this repo. The SDK adds, in its next release:
 *   - the page element `brandComponent` { name, variant, slots }
 *   - the command `insertBrandComponent` { sectionId, name, variant?, slots? }
 *   - the command `saveAsBrandComponent` { sectionId, name }  (componentFromSelection turns the section into a component row)
 * Until that release is installed here, page_edit answers those two commands with a plain explanation instead of the SDK's generic
 * "unknown command". When the release lands:
 *   1. set BRAND_COMPONENT_COMMANDS_READY to true (the commands then fall through to applyCommands untouched),
 *   2. in lib/mcp/v2Pages.ts saveEdit, for each ok `saveAsBrandComponent` result take the component row the SDK returns and call
 *      sendComponentsToStrata (lib/brand/extrasWriteThrough.ts), which already creates it in Strata, publishes it and keeps the
 *      owner's copy when Strata is unreachable.
 */
export const BRAND_COMPONENT_COMMANDS_READY = true;

export const BRAND_COMPONENT_OPS: ReadonlySet<string> = new Set(["insertBrandComponent", "saveAsBrandComponent"]);

/** Plain words for an AI helping an owner when the command can't be used yet. */
export function brandComponentCommandMessage(op: string): string {
  return op === "saveAsBrandComponent"
    ? "Saving a section as a brand component from page_edit isn't available yet. Describe it with create_brand_component (name, styles, slots) to save it to the brand in Strata instead."
    : "Placing a brand component with page_edit isn't available yet. Build the section in the brand's look instead (get_brand_tokens gives its variables, list_brand_components its components), and tell the owner in plain words.";
}
