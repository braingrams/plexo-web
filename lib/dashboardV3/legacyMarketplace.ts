/**
 * The marketplace used to have public pages (/marketplace and /marketplace/<id>). It now lives only
 * inside the dashboard, so old links (emails, bookmarks, Stripe returns, search results) are sent to
 * the matching dashboard page. The dashboard then handles sign-in and brings people back.
 * Returns null for any path that isn't an old marketplace page.
 */
export function legacyMarketplaceRedirect(pathname: string): string | null {
  const m = /^\/marketplace(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ? `/dashboard/marketplace/${m[1]}` : "/dashboard/marketplace";
}
