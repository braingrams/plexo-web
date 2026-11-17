import { siteHubHref } from "./hubPaths";

export type CommerceNavItem = { href: string; label: string };

/**
 * The shop's one row of tabs on the new dashboard. Products and Orders live in the site hub (so they
 * link there); everything else is a shop page of its own. Plain words, no jargon.
 */
export function commerceNavItems(siteId: string, opts: { sellsServices?: boolean } = {}): CommerceNavItem[] {
  const base = `/dashboard/commerce/${siteId}`;
  return [
    { href: siteHubHref(siteId, "products"), label: "Products" },
    { href: siteHubHref(siteId, "orders"), label: "Orders" },
    { href: `${base}/customers`, label: "Customers" },
    { href: `${base}/discounts`, label: "Discounts" },
    { href: `${base}/delivery`, label: "Delivery" },
    ...(opts.sellsServices === false ? [] : [{ href: `${base}/availability`, label: "Booking times" }]),
    { href: `${base}/donations`, label: "Donations" },
    { href: `${base}/wallet`, label: "Your money" },
    { href: `${base}/settings`, label: "Shop settings" },
  ];
}

/** Which tab a shop page belongs to (the sub-pages are prefixes, e.g. settings/payments is "Shop settings"). */
export function currentCommerceHref(items: CommerceNavItem[], pathname: string): string {
  return items.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.href ?? "";
}

/** Where the bare /dashboard/commerce entry sends a new-dashboard owner: the orders tab (the nav item is "Orders"). */
export function commerceEntryHref(siteId: string): string {
  return siteHubHref(siteId, "orders");
}

/** The shop to open from the bare "Orders" link: the most recent site whose shop is on, else the most recent site. `sites` is newest first. */
export function pickShopSiteId(sites: { id: string; enabled: boolean }[]): string | null {
  return (sites.find((s) => s.enabled) ?? sites[0])?.id ?? null;
}
