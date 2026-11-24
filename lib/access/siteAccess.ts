/**
 * Access to ONE site, not the whole workspace.
 *
 * A teammate can be invited to some sites only, each with its own role. They sign in and see just those sites; everything else in the
 * workspace (other sites, billing, team, domains, the marketplace, API keys, SOL) is closed to them by default. This file holds the rules
 * that don't touch the database, so they are tested once and shared by the API gate, the dashboard gate and the Team screens.
 *
 * Fail closed: anything not listed here as allowed is refused for a site-only member.
 */

export const SITE_ROLES = ["editor", "blogger", "commenter", "viewer"] as const;
export type SiteRole = (typeof SITE_ROLES)[number];
/** Who can do what on a site, keyed by the site's id (its home page's id). */
export type SiteAccess = Record<string, SiteRole>;

export const SITE_ROLE_INFO: Record<SiteRole, { label: string; help: string }> = {
  editor: { label: "Editor", help: "Change pages, the blog, the shop and forms, and publish this site." },
  blogger: { label: "Writer", help: "Write and publish blog posts on this site. Nothing else." },
  commenter: { label: "Reviewer", help: "Look at this site and leave comments for the team." },
  viewer: { label: "Viewer", help: "Look at this site. Nothing can be changed." },
};

const isSiteRole = (v: unknown): v is SiteRole => typeof v === "string" && (SITE_ROLES as readonly string[]).includes(v);

/** Whatever was stored, reduced to real site ids and known roles. Never throws. */
export function cleanSiteAccess(raw: unknown): SiteAccess {
  const out: SiteAccess = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, role] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (id && isSiteRole(role)) out[id] = role;
  }
  return out;
}

export const hasSiteAccess = (access: SiteAccess | null | undefined): access is SiteAccess => !!access && Object.keys(access).length > 0;

/** Sites a member may see: `null` means every site (an ordinary member), otherwise exactly the listed ones. */
export const visibleSiteIds = (isGuest: boolean, access: SiteAccess | null | undefined): string[] | null => (isGuest ? Object.keys(access ?? {}) : null);

export type GuestDecision = { kind: "site"; siteId: string; /** The call acts on the site itself (a delete), not a page of it. */ wholeSite?: boolean } | { kind: "open" } | { kind: "denied" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The API families whose first id is a site (or one of its pages). Anything outside these is not site work.
const API_SITE_PREFIXES = ["/api/templates", "/api/v1/templates", "/api/v1/sites", "/api/site-layout", "/api/blog", "/api/v1/commerce", "/api/v1/apps", "/api/v1/lms/funnels"];

// Settings that need extra care are never open to a site-only member, whatever their role on the site: they can change who owns the
// site, where it lives, what it costs, where money and messages go, or run code on it. Only the owner or an admin of the workspace.
// Matched on the part of the address after the site's id.
const SENSITIVE_AFTER_ID = [
  /^badge(\/|$)/, /^deploy(\/|$)/, /^script-access(\/|$)/, /^ssr-/, /^form-settings(\/|$)/, /^redirects(\/|$)/, /^redirect-tools(\/|$)/,
  /^page-code(\/|$)/, /^robots(\/|$)/, /^restore-points(\/|$)/, /^replace-upload(\/|$)/, /^email-settings(\/|$)/,
  /^transfer(\/|$)/, /^convert-/, /^eject(\/|$)/, /^reset-to-builder(\/|$)/, /^revert-to-classic(\/|$)/, /^duplicate-site(\/|$)/,
  /^settings(\/|$)/, /^wallet(\/|$)/, /^secrets(\/|$)/, /^github(\/|$)/, /^db(\/|$)/, /^import(\/|$)/, /^custom-code(\/|$)/,
  /(^|\/)refund(\/|$)/, /(^|\/)stripe(\/|$)/, /^withdrawals?(\/|$)/,
];

/** True for an address inside a site that is a sensitive setting (see above). Pure. */
export function isSensitiveSiteCall(afterId: string[]): boolean {
  const rest = afterId.join("/");
  return SENSITIVE_AFTER_ID.some((re) => re.test(rest));
}

// Plain, id-free API calls a site-only member still needs, with the methods they may use. Lists are filtered to their sites by the route.
const API_OPEN: Array<{ path: string; methods: string[] }> = [
  { path: "/api/profile", methods: ["GET", "PATCH"] },
  { path: "/api/v1/notifications", methods: ["GET", "POST"] },
  { path: "/api/v1/media/upload", methods: ["POST"] },
  { path: "/api/templates", methods: ["GET"] },
];

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** What a site-only member may do with an API call: work on one site (the id in the address), use an open call, or nothing. */
export function classifyGuestApi(pathname: string, method: string, search = ""): GuestDecision {
  const path = trim(pathname);
  const verb = method.toUpperCase();
  const open = API_OPEN.find((o) => o.path === path);
  if (open) return open.methods.includes(verb) ? { kind: "open" } : { kind: "denied" };
  const prefix = API_SITE_PREFIXES.find((p) => path === p || path.startsWith(`${p}/`));
  if (prefix) {
    const rest = path.slice(prefix.length).split("/").filter(Boolean);
    const id = rest[0];
    if (!id || !UUID.test(id)) return { kind: "denied" };
    if (isSensitiveSiteCall(rest.slice(1))) return { kind: "denied" };
    // Taking the whole site away is never a site-only member's call. (Deleting one of its pages is fine; that is editing.)
    if (verb === "DELETE" && rest.length === 1) return { kind: "site", siteId: id, wholeSite: true };
    return { kind: "site", siteId: id };
  }
  // Analytics and similar calls name the site in the query.
  if (/^\/api\/v1\/analytics(\/|$)/.test(path)) {
    const id = new URLSearchParams(search).get("templateId") ?? new URLSearchParams(search).get("siteId");
    if (id && UUID.test(id)) return { kind: "site", siteId: id };
  }
  return { kind: "denied" };
}

const PAGE_SITE_PREFIXES = ["/dashboard/sites", "/dashboard/templates", "/dashboard/commerce", "/dashboard/apps", "/dashboard/funnels"];
// Dashboard screens for sensitive settings, closed to a site-only member like their API calls.
const SENSITIVE_PAGES = [/^transfer(\/|$)/, /^detail(\/|$)/, /^redirects(\/|$)/, /^settings(\/|$)/, /^site-import(\/|$)/, /^site-layout(\/|$)/, /^blog\/settings(\/|$)/, /^wallet(\/|$)/];
const PAGE_OPEN = ["/dashboard", "/dashboard/sites", "/dashboard/profile", "/dashboard/notifications"];

/** What a site-only member may open in the dashboard: the lists (filtered to their sites), one of their sites, or nothing. */
export function classifyGuestPage(pathname: string): GuestDecision {
  const path = trim(pathname);
  if (PAGE_OPEN.includes(path)) return { kind: "open" };
  const prefix = PAGE_SITE_PREFIXES.find((p) => path.startsWith(`${p}/`));
  if (prefix) {
    const parts = path.slice(prefix.length).split("/").filter(Boolean);
    const id = parts[0];
    if (id && UUID.test(id)) {
      if (SENSITIVE_PAGES.some((re) => re.test(parts.slice(1).join("/")))) return { kind: "denied" };
      return { kind: "site", siteId: id };
    }
  }
  return { kind: "denied" };
}

/**
 * Which tabs of a site's page each site role gets. Settings, Advanced, Web address and More hold the things that need extra care
 * (domains, code, transfer, delete, money), so no site-only role has them.
 */
export const GUEST_HUB_TABS: Record<SiteRole, string[]> = {
  editor: ["pages", "products", "orders", "shop", "donations", "blog", "course", "brand", "visits", "health"],
  blogger: ["blog"],
  commenter: ["pages", "visits"],
  viewer: ["pages", "visits"],
};
export const guestHubTabAllowed = (role: SiteRole, tab: string): boolean => GUEST_HUB_TABS[role].includes(tab);
export const guestFirstTab = (role: SiteRole): string => GUEST_HUB_TABS[role][0];
