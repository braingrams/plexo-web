import type { TemplateKind } from "@/lib/db/contentEntities";

import { compileDesignJsonForKind } from "@/lib/compileForKind";
import { compileV2Design, compileV2Email, type V2LayoutSections } from "@/lib/v2/compile";
import { designFormatOf } from "@/lib/v2/design";

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
    if (template.kind === "EMAIL") return compileV2Email(template.designJson, { name: template.name ?? "" });
    return compileV2Design(template.designJson, {
      rootTemplateId: ctx.rootTemplateId ?? template.id ?? "",
      pageTemplateId: template.id ?? "",
      name: template.name ?? "",
      layout: ctx.layout ?? null,
    });
  }
  return compileDesignJsonForKind(template.designJson, template.kind);
}
