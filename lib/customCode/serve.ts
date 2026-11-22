// Serve-time half of "Header and footer code": adds the owner's saved snippets to a published page.
// Runs only in the public site route, never in the editor or dashboard, and only when the page is
// served from a custom domain on a plan that includes it (lib/customCode/gate.ts). The saved code
// was validated and re-written when it was saved (sanitizeCustomCode); it is re-checked here so a
// row written any other way still can't put anything unexpected on a page.
//
// Where it goes: header code at the end of <head>, footer code at the end of <body>, once per page.
// It is NOT added (a) when the page is being shown inside another page (an iframe: the outer page
// already carries it, so visits would be counted twice), nor (b) on cart, checkout, donation and
// order pages, where a third-party script could see card and delivery details, unless the owner
// switched on "Also run on checkout pages" (SiteLayout.customCodeOnCheckout).

import { SiteLayout } from "@/lib/db/contentEntities";
import { injectCustomCode } from "@/lib/pub/htmlInject";
import { customCodeRunsOnServe } from "./gate";
import { sanitizeCustomCode } from "./sanitize";

/** Markers the Plexo cart, checkout, order and donation blocks compile to. */
const PAYMENT_MARKERS = /data-plexo-commerce-(cartsummary|checkoutflow|orderconfirmation|ordertracking)|data-plexo-donation\b|js\.stripe\.com/i;

/** A page where visitors enter payment, delivery or order details. */
export function isPaymentPage(html: string): boolean {
  return PAYMENT_MARKERS.test(html);
}

/** Sec-Fetch-Dest values that mean "this page is shown inside another page". */
export function isEmbeddedRequest(secFetchDest: string | null | undefined): boolean {
  return /^(iframe|frame|embed|object)$/i.test((secFetchDest ?? "").trim());
}

export async function applyOwnerCode(
  html: string,
  site: { templateId: string; type: string; plan: string | null | undefined; secFetchDest?: string | null },
): Promise<string> {
  if (!customCodeRunsOnServe({ plan: site.plan, servedOnCustomDomain: site.type === "CUSTOM" })) return html;
  if (isEmbeddedRequest(site.secFetchDest)) return html;
  try {
    const { data } = await SiteLayout.get({ templateId: site.templateId }).go();
    if (!data?.customHeadCode && !data?.customFooterCode) return html;
    if (!data.customCodeOnCheckout && isPaymentPage(html)) return html;
    const head = sanitizeCustomCode(data.customHeadCode);
    const footer = sanitizeCustomCode(data.customFooterCode);
    return injectCustomCode(html, { head: head.ok ? head.html : "", footer: footer.ok ? footer.html : "" });
  } catch {
    return html; // never take a page down over the owner's extras
  }
}
