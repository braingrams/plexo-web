import { buildFunnelStarterV2 } from "@/lib/v2/layoutDesigns";
import { compileGenerated, siteInfo } from "@/lib/v2/siteFormat";
import type { DesignFormat } from "@/lib/v2/design";
import { lmsSignupEmbedSnippet } from "./embedSnippet";

/**
 * A brand-new funnel's root Template starts with this design rather than a genuinely blank
 * page — same "a site owner shouldn't have to make a design decision before it works"
 * philosophy as Commerce's own ensureProductDetailLayout/PRODUCT_DETAIL_STARTER_DESIGN_JSON
 * (lib/commerce/productDetailLayout.ts), which this mirrors closely. The one interactive
 * piece — the signup form — is the exact same `data-plexo-lms-signup` marker + copyable
 * snippet Funnel Settings' "Embed your signup form" hands out (see embedSnippet.ts), just
 * pre-placed inside an 'html' block here instead of requiring the admin to paste it in
 * themselves. Nothing about the marker or its runtime (public/lms-signup.js) cares whether
 * it arrived this way or was hand-typed into a raw HTML upload — same mechanism either way.
 */
export function buildFunnelStarterDesignJson(funnelName: string, templateId: string): object {
  const escapedName = funnelName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    body: {
      style: { background: "#0b0f19", fontFamily: "inherit" },
      rows: [
        {
          id: "row-lms-hero",
          style: { padding: "80px 24px", textAlign: "center" },
          columns: [
            {
              id: "col-lms-hero",
              width: "100%",
              styles: {},
              elements: [
                {
                  id: "el-lms-hero-html",
                  type: "html",
                  style: { width: "100%" },
                  attributes: {
                    htmlContent:
                      `<div style="max-width:640px;margin:0 auto;">` +
                      `<h1 style="font-size:32px;font-weight:800;color:#ffffff;margin:0 0 12px;">${escapedName}</h1>` +
                      `<p style="font-size:16px;color:rgba(255,255,255,0.65);margin:0 0 36px;">Sign up below to get started.</p>` +
                      `${lmsSignupEmbedSnippet(templateId)}` +
                      `</div>`,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * `designFormat` says which editor owns the funnel's page: a classic (v1) site gets the
 * classic starter above, unchanged; a new-editor (v2) site gets the same "heading + working
 * signup form" as one editable Sign-up section (its form is the same `data-plexo-lms-signup`
 * marker, so public/lms-signup.js needs nothing new). Callers store `designFormat` with it.
 */
export async function compileFunnelStarterDesign(
  funnelName: string,
  templateId: string,
): Promise<{ designJson: object; compiledHtml: string; designFormat: DesignFormat }> {
  const { format } = await siteInfo(templateId);
  const designJson = format === "v2" ? buildFunnelStarterV2(funnelName) : buildFunnelStarterDesignJson(funnelName, templateId);
  const compiledHtml = await compileGenerated(templateId, { id: templateId, name: funnelName, designFormat: format, designJson });
  return { designJson, compiledHtml, designFormat: format };
}
