import { siteHubHref } from "./hubPaths";

/**
 * An address into one of the old per-site pages, rewritten to the matching tab of the site's home in the new
 * dashboard. Anything that isn't an old per-site page is returned unchanged. Pure.
 */
export function toHubHref(href: string): string {
  const m = /^\/dashboard\/(?:templates|apps)\/([^/?#]+)\/detail(?:[?#].*)?$/.exec(href) ?? /^\/dashboard\/apps\/([^/?#]+)(?:[?#].*)?$/.exec(href);
  return m ? siteHubHref(m[1], "app") : href;
}
