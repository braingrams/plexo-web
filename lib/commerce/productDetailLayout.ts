/**
 * The reusable "Product Detail" layout Template (CommerceSettings.productDetailTemplateId) —
 * one Template serves every product on a site, same shape as BlogSite.postLayoutTemplateId.
 * A brand-new one is seeded with a single `product` element in `mode: "detail"` — the one
 * marker whose runtime (commerce.js's renderProductDetail) draws the entire page from a
 * single node: image, name, price, description, add-to-cart, AND the "frequently bought
 * together" grid, all client-side off the visited URL. So a working starter genuinely needs
 * nothing else; the site owner can then move/restyle that one element, or add their own
 * text/branding around it, the same as customizing any other page.
 *
 * `mode: "detail"` is deliberately excluded from the properties panel (see
 * CommerceProductPropertiesAccordion — reserved/internal, never user-selectable) since a
 * page normally has at most one of these and setting it wrong would break every product
 * page at once. That's exactly why this file exists: the only way to get a valid one is to
 * seed it here, once, at creation time.
 */
export const PRODUCT_DETAIL_STARTER_DESIGN_JSON = {
  body: {
    style: { background: "#ffffff", fontFamily: "inherit" },
    rows: [
      {
        id: "row-product-detail",
        style: { padding: "32px 0" },
        columns: [
          {
            id: "col-product-detail",
            width: "100%",
            styles: {},
            elements: [
              {
                id: "el-product-detail",
                type: "product",
                style: { width: "100%", minHeight: "700px" },
                attributes: { mode: "detail" },
              },
            ],
          },
        ],
      },
    ],
  },
};

/** True once the layout's compiled output actually contains the detail marker — mirrors
 * hasBlogMarker (lib/pub/blogLayoutRender.ts): a freshly-attached "use existing" clone from
 * another site is always ready; a from-scratch one only stops being ready if someone deletes
 * the seeded element in the builder. */
export function hasProductDetailMarker(compiledHtml: string): boolean {
  return /data-plexo-commerce-product="true"[^>]*data-plexo-commerce-mode="detail"/i.test(compiledHtml);
}
