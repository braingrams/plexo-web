/**
 * Pure helpers for the slim progress bar at the top of the new dashboard: which clicks count as
 * "going somewhere in the dashboard" (so the bar starts the instant they happen) and how far along
 * the bar looks while we wait. No DOM here, so it is easy to test.
 */

export type ClickInfo = {
  /** The link's href attribute, as written. */
  href: string | null;
  /** The link's target attribute. */
  target?: string | null;
  /** The link has a download attribute. */
  download?: boolean;
  /** Mouse button (0 is a normal left click). */
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

/** Where the app lives: the real dashboard, and the dev previews that wear the same frame. */
const IN_APP = /^\/(?:dashboard|v3-preview)(?:\/|$)/;

/**
 * True when a click on this link moves to a different dashboard page (or a different tab or section
 * of the same page), so the owner should see something happen right away. False for anything that
 * stays put: new tabs, downloads, modified clicks, other websites, jumps within the page, mailto, and
 * a link to the page you are already on.
 */
export function isInternalNavigation(c: ClickInfo, current: { origin: string; pathname: string; search: string }): boolean {
  if (!c.href) return false;
  if (c.button !== undefined && c.button !== 0) return false;
  if (c.metaKey || c.ctrlKey || c.shiftKey || c.altKey) return false;
  if (c.download) return false;
  if (c.target && c.target !== "_self") return false;
  let url: URL;
  try {
    url = new URL(c.href, current.origin + current.pathname + current.search);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  if (!IN_APP.test(url.pathname)) return false;
  // Only a #jump on this same page: nothing to wait for.
  if (url.pathname === current.pathname && url.search === current.search) return false;
  return true;
}

/** A key that changes whenever the page, or its tab/section, changes. */
export function routeKey(pathname: string | null | undefined, search: string | null | undefined): string {
  return `${pathname ?? ""}?${search ?? ""}`;
}

/** The bar eases towards 90% while waiting and never reaches it: it only finishes when the page has changed. */
export function nextProgress(p: number): number {
  const step = Math.max(0.4, (90 - p) * 0.08);
  return Math.min(90, p + step);
}
