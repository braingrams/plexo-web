/**
 * The two different things a site owner can open, kept apart on purpose (pure):
 * - Preview: a private look at the working copy. Owner-only, works before the site is online, and shows what
 *   visitors will see after the next "Put it online".
 * - Open my site: the live address visitors use. Only exists when the site is online and has an address.
 * Never link one to the other.
 */
export const OPEN_SITE_HINT = "Put your site online first";

/** The owner-only private preview of a site's working copy. */
export function previewHref(siteId: string): string {
  return `/api/v1/templates/${encodeURIComponent(siteId)}/draft-preview`;
}

/** The live address (https) for an online site with an address, else null. */
export function liveHref(site: { status?: "live" | "draft" | string | null; address?: string | null }): string | null {
  const host = (site.address ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host || site.status === "draft") return null;
  return `https://${host}`;
}
