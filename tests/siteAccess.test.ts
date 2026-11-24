import { describe, expect, it } from "vitest";
import { classifyGuestApi, classifyGuestPage, cleanSiteAccess, guestFirstTab, guestHubTabAllowed, hasSiteAccess, isSensitiveSiteCall, visibleSiteIds } from "@/lib/access/siteAccess";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("site access data", () => {
  it("keeps only real roles on real ids", () => {
    expect(cleanSiteAccess({ [A]: "editor", [B]: "viewer", x: "owner", y: 5, z: "admin" })).toEqual({ [A]: "editor", [B]: "viewer" });
    expect(cleanSiteAccess(null)).toEqual({});
    expect(cleanSiteAccess([A])).toEqual({});
    expect(hasSiteAccess({})).toBe(false);
    expect(hasSiteAccess({ [A]: "editor" })).toBe(true);
  });
  it("an ordinary member sees every site; a site-only member sees theirs", () => {
    expect(visibleSiteIds(false, {})).toBeNull();
    expect(visibleSiteIds(true, { [A]: "editor" })).toEqual([A]);
    expect(visibleSiteIds(true, null)).toEqual([]);
  });
});

describe("what a site-only member may call", () => {
  it("work on one site is tied to the site in the address, whatever the family", () => {
    for (const p of [`/api/templates/${A}`, `/api/v1/templates/${A}/files`, `/api/v1/templates/${A}/files/css/site.css`, `/api/site-layout/${A}/looks`, `/api/blog/${A}/posts`, `/api/v1/commerce/${A}/products`, `/api/v1/apps/${A}/files`]) {
      expect(classifyGuestApi(p, "PATCH"), p).toEqual({ kind: "site", siteId: A });
    }
  });
  it("organisation-wide and money calls are refused", () => {
    for (const p of ["/api/org/invite", "/api/org/members/u1", "/api/organizations/x/branding", "/api/v1/domains", "/api/v1/domains/purchase", "/api/settings/api-keys", "/api/billing/receipts/1", "/api/v1/commerce/stripe-access", "/api/v1/sol/chat", "/api/v1/marketplace/templates", "/api/site-transfers", "/api/internal/domains", "/api/v1/publish"]) {
      expect(classifyGuestApi(p, "GET"), p).toEqual({ kind: "denied" });
    }
  });
  it("a family call with no site id in it is refused, not guessed", () => {
    expect(classifyGuestApi("/api/templates/update", "POST")).toEqual({ kind: "denied" });
    expect(classifyGuestApi("/api/v1/commerce/stripe-access", "POST")).toEqual({ kind: "denied" });
  });
  it("a few plain calls are open, with only the methods they need", () => {
    expect(classifyGuestApi("/api/profile", "GET")).toEqual({ kind: "open" });
    expect(classifyGuestApi("/api/templates", "GET")).toEqual({ kind: "open" });
    expect(classifyGuestApi("/api/templates", "POST")).toEqual({ kind: "denied" });
    expect(classifyGuestApi("/api/v1/notifications", "POST")).toEqual({ kind: "open" });
  });
  it("analytics name the site in the query", () => {
    expect(classifyGuestApi("/api/v1/analytics", "GET", `?templateId=${A}`)).toEqual({ kind: "site", siteId: A });
    expect(classifyGuestApi("/api/v1/analytics", "GET", "")).toEqual({ kind: "denied" });
  });
});

describe("what a site-only member may open", () => {
  it("home, the site list and their own profile are open; one site is tied to its id", () => {
    for (const p of ["/dashboard", "/dashboard/sites", "/dashboard/profile", "/dashboard/notifications"]) expect(classifyGuestPage(p), p).toEqual({ kind: "open" });
    for (const p of [`/dashboard/sites/${A}`, `/dashboard/templates/${A}`, `/dashboard/templates/${A}/blog/posts`, `/dashboard/commerce/${A}/orders`, `/dashboard/apps/${A}`]) expect(classifyGuestPage(p), p).toEqual({ kind: "site", siteId: A });
  });
  it("billing, team, domains, orders overview, marketplace, developers and SOL are closed", () => {
    for (const p of ["/dashboard/settings/subscription", "/dashboard/settings/team", "/dashboard/domains", "/dashboard/commerce", "/dashboard/marketplace/sell", "/dashboard/sol", "/dashboard/emails", "/dashboard/templates", "/dashboard/new", "/dashboard/transfers"]) {
      expect(classifyGuestPage(p), p).toEqual({ kind: "denied" });
    }
  });
});

describe("settings that need extra care are closed to every site role", () => {
  it("API: transfer, convert, delete-site, domains-like and money settings, code, secrets, redirects, webhooks", () => {
    const sensitive = [
      `/api/templates/${A}/transfer`, `/api/templates/${A}/convert-type`, `/api/templates/${A}/duplicate-site`, `/api/templates/${A}/eject`,
      `/api/v1/templates/${A}/badge`, `/api/v1/templates/${A}/ssr-secrets`, `/api/v1/templates/${A}/ssr-variables`, `/api/v1/templates/${A}/script-access`,
      `/api/v1/templates/${A}/form-settings`, `/api/v1/templates/${A}/redirects`, `/api/v1/templates/${A}/redirects/old/page`, `/api/v1/templates/${A}/redirect-tools/bulk`,
      `/api/v1/templates/${A}/page-code`, `/api/v1/templates/${A}/robots`, `/api/v1/templates/${A}/restore-points`, `/api/v1/templates/${A}/replace-upload`,
      `/api/site-layout/${A}/custom-code`, `/api/v1/commerce/${A}/settings`, `/api/v1/commerce/${A}/wallet/withdrawals`, `/api/v1/apps/${A}/secrets`, `/api/v1/apps/${A}/github`,
      `/api/v1/apps/${A}/db`, `/api/blog/${A}/import`, `/api/v1/commerce/${A}/orders/o1/refund`,
    ];
    for (const p of sensitive) expect(classifyGuestApi(p, "PUT"), p).toEqual({ kind: "denied" });
    expect(isSensitiveSiteCall(["transfer"])).toBe(true);
    expect(isSensitiveSiteCall(["pages"])).toBe(false);
  });
  it("everyday content work stays open", () => {
    for (const p of [`/api/templates/${A}/pages`, `/api/templates/${A}/publish`, `/api/v1/templates/${A}/files`, `/api/v1/templates/${A}/text-content`, `/api/v1/templates/${A}/page-seo`, `/api/blog/${A}/posts`, `/api/v1/commerce/${A}/products`, `/api/v1/commerce/${A}/orders`]) {
      expect(classifyGuestApi(p, "PUT"), p).toEqual({ kind: "site", siteId: A });
    }
  });
  it("deleting the site itself is flagged so it can be refused; deleting a page is not", () => {
    expect(classifyGuestApi(`/api/templates/${A}`, "DELETE")).toEqual({ kind: "site", siteId: A, wholeSite: true });
    expect(classifyGuestApi(`/api/templates/${A}/pages`, "DELETE")).toEqual({ kind: "site", siteId: A });
  });
  it("pages: transfer, settings, redirects, header/footer code and shop settings screens are closed", () => {
    for (const p of [`/dashboard/templates/${A}/transfer`, `/dashboard/templates/${A}/detail`, `/dashboard/templates/${A}/redirects`, `/dashboard/templates/${A}/site-layout`, `/dashboard/commerce/${A}/settings/payments`, `/dashboard/templates/${A}/blog/settings`]) {
      expect(classifyGuestPage(p), p).toEqual({ kind: "denied" });
    }
    expect(classifyGuestPage(`/dashboard/templates/${A}/blog/posts`)).toEqual({ kind: "site", siteId: A });
  });
  it("the site page shows each role only the tabs it may use, never settings, advanced, address or more", () => {
    for (const role of ["editor", "blogger", "commenter", "viewer"] as const) {
      for (const tab of ["settings", "advanced", "address", "more"]) expect(guestHubTabAllowed(role, tab), `${role} ${tab}`).toBe(false);
    }
    expect(guestHubTabAllowed("editor", "pages")).toBe(true);
    expect(guestHubTabAllowed("blogger", "pages")).toBe(false);
    expect(guestFirstTab("blogger")).toBe("blog");
  });
});
