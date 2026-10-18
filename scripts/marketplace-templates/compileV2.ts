import { convertV1Design } from "@charisol/plexo-sdk/v2/compile";

import { TemplateJSONSchema, hydrateStructuralDefaults } from "../../server/sanitizer";
import { compileV2Design } from "../../lib/v2/compile";
import { parseV2Design, V2_FORMAT, type V2Design } from "../../lib/v2/design";
import { compileSpecToDesignJson } from "./compile";
import type { TemplateSpec } from "./types";

export type V2Compiled = {
  design: V2Design;
  html: string;
  /** What the SDK could not carry over, in plain words — a human reviews these before a template is published. */
  warnings: string[];
  fidelity: "exact" | "approximate" | "partial";
};

/**
 * The V2 twin of compileSpecToDesignJson: the spec still builds the classic layout (one place that
 * gets the section shapes right), which the SDK's converter turns into a V2 page. Marketplace
 * templates therefore open in the visual editor (V2) like everything else. Email specs are NOT
 * converted — email stays on the classic editor — so this returns null for them.
 */
export function compileSpecToV2(spec: TemplateSpec, templateIndex: number): V2Compiled | null {
  if (spec.kind === "EMAIL") return null;
  const classic = TemplateJSONSchema.parse(hydrateStructuralDefaults(compileSpecToDesignJson(spec, templateIndex)));
  const converted = convertV1Design(classic, { id: `t${templateIndex}-page`, name: spec.name, isHome: true });
  const parsed = parseV2Design({
    format: V2_FORMAT,
    pages: [converted.page],
    ...(converted.extras.customJs ? { customJs: converted.extras.customJs } : {}),
    meta: { htmlTitle: spec.pageStyle.htmlTitle || spec.name },
  });
  if (!parsed.ok) throw new Error(`converted page is not a valid V2 design: ${parsed.error}`);
  const html = compileV2Design(parsed.design, { rootTemplateId: `t${templateIndex}`, pageTemplateId: `t${templateIndex}`, name: spec.name });
  return { design: parsed.design, html, warnings: converted.warnings, fidelity: converted.fidelity };
}
