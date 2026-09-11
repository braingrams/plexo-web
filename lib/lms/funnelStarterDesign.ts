import { compileToHTML } from "@/lib/compiler";
import { sanitizeHtml } from "@/server/sanitizer";
import { getEnabledSiteLayoutRows, spliceLayoutRows } from "@/lib/siteLayoutCore";
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

export async function compileFunnelStarterDesign(funnelName: string, templateId: string): Promise<{ designJson: object; compiledHtml: string }> {
  const designJson = buildFunnelStarterDesignJson(funnelName, templateId);
  const layout = await getEnabledSiteLayoutRows(templateId);
  const spliced = spliceLayoutRows(designJson, layout);
  const compiledHtml = sanitizeHtml(compileToHTML(spliced));
  return { designJson, compiledHtml };
}
