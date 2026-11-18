import { resolveDesignSystem } from "@/lib/v2/designSystemStore";
import type { TemplateKind } from "@/lib/db/contentEntities";

import { compileDesignJsonForKind } from "@/lib/compileForKind";
import { compileV2Design, compileV2Email, type V2LayoutSections } from "@/lib/v2/compile";
import { designFormatOf } from "@/lib/v2/design";

/**
 * A site with a brand linked from Strata (lib/brand/siteBrand.ts): its pages are built with THAT brand's tokens and components,
 * so the values written into the page match the hosted brand sheet (which overrides them live anyway) and a component change
 * in Strata reaches the page on the rebuild the sync starts. The page's own Plexo-only settings (density, uploaded fonts) stay.
 * Best effort: if the brand can't be read, the page is built with its own design system and the sheet still applies.
 */
async function withSiteBrand(designJson: unknown, siteId: string): Promise<unknown> {
  if (!siteId || !designJson || typeof designJson !== "object") return designJson;
  try {
    const { linkedDesignSystem } = await import("@/lib/brand/siteBrand");
    const brand = await linkedDesignSystem(siteId);
    if (!brand) return designJson;
    const design = designJson as { designSystem?: Record<string, unknown> };
    const own = design.designSystem ?? {};
    return { ...design, designSystem: { ...own, ...brand, options: own.options ?? brand.options, fonts: (brand.fonts ?? own.fonts) } };
  } catch (err) {
    console.warn(`[site-brand] ${siteId}: building without the linked brand`, err);
    return designJson;
  }
}

/** Whatever carries a design: a Template row, or a payload about to become one. */
export type CompilableTemplate = {
  designFormat?: string | null;
  designJson: unknown;
  kind: TemplateKind;
  id?: string;
  name?: string;
};

export type CompileTemplateContext = {
  /** Site root id — V2 forms post to Plexo's inbox for this site. Defaults to the template's own id (a home page IS its root). */
  rootTemplateId?: string;
  /** V2 only: the site's header/footer sections to put around the page (V1 callers splice rows into designJson beforehand). */
  layout?: V2LayoutSections | null;
};

/**
 * THE one place a template's design becomes compiledHtml, for either format:
 *   - "v1" (and anything missing): exactly today's path — compileDesignJsonForKind (local flexbox
 *     compiler + V1 sanitiser for landing pages; MJML for email). V1 designJson must already have
 *     any header/footer rows spliced in (siteLayoutCore.compileTemplateWithSiteLayout does that).
 *   - "v2": SDK compilePageToHtml -> sanitizeV2Html -> owner script/head details (lib/v2/compile.ts).
 *     V2 output never touches V1's sanitiser. A V2 EMAIL goes through the SDK's email compiler instead (tables + inline styles).
 * Throws on a design that can't be compiled (V2DesignError messages are safe to show the owner).
 */
export async function compileTemplate(template: CompilableTemplate, ctx: CompileTemplateContext = {}): Promise<string> {
  if (designFormatOf(template) === "v2") {
    // A big brand is kept in storage and the row holds a reference: bring it back before compiling.
    let designJson = await resolveDesignSystem(template.designJson);
    if (template.kind === "EMAIL") return compileV2Email(designJson, { name: template.name ?? "" });
    designJson = await withSiteBrand(designJson, ctx.rootTemplateId ?? template.id ?? "");
    return compileV2Design(designJson, {
      rootTemplateId: ctx.rootTemplateId ?? template.id ?? "",
      pageTemplateId: template.id ?? "",
      name: template.name ?? "",
      layout: ctx.layout ?? null,
    });
  }
  return compileDesignJsonForKind(template.designJson, template.kind);
}
