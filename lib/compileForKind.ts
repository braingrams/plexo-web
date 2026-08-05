import type { TemplateKind } from "@prisma/client";

import { compileToHTML } from "@/lib/compiler";
import { parseJsonToTargetFormat } from "@/lib/compilerClient";
import { sanitizeHtml } from "@/server/sanitizer";

/**
 * Compiles a validated designJson tree into compiledHtml for a given template kind — the
 * same branch app/api/v1/compile/route.ts's compileParsedRequest applies (LANDING_PAGE via
 * the local flexbox compiler, EMAIL via MJML→table HTML), factored out so a template's
 * kind can change without hand-duplicating that branch elsewhere.
 */
export async function compileDesignJsonForKind(
  designJson: any, // TemplateJSON structure — same convention as server/sanitizer.ts's SanitizedBuilderPayload
  kind: TemplateKind,
): Promise<string> {
  if (kind === "EMAIL") {
    const mjml = parseJsonToTargetFormat(designJson, "email");
    const { default: mjml2html } = await import("mjml");
    const { html } = mjml2html(mjml, { validationLevel: "soft" });
    return sanitizeHtml(html);
  }

  return sanitizeHtml(compileToHTML(designJson));
}
