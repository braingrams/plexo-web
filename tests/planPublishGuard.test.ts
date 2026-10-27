import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  plan: "FREE",
  page: null as Record<string, unknown> | null,
  sites: [] as unknown[],
  published: [] as string[],
  republished: [] as string[],
}));

vi.mock("@/lib/auth/resolveUser", () => ({
  resolveUser: async () => ({ userId: "u1", organizationId: "org1", role: null, subscriptionPlan: state.plan, customDomainLimit: null, manageLandingPagePublishing: false }),
}));
vi.mock("@/server/requirePermissionDynamo", () => ({ requirePermission: () => null }));
vi.mock("@/server/requireTemplateScope", () => ({ requireTemplateScope: () => null }));
vi.mock("@/lib/siteLayoutDynamo", () => ({ compileTemplateWithSiteLayout: async () => "<html><body>page</body></html>", onTemplateSaved: async () => {} }));
vi.mock("@/lib/compiler", () => ({ compileToHTML: () => "<html><body>page</body></html>" }));
vi.mock("@/server/sanitizer", () => ({ sanitizeHtml: (h: string) => h }));
vi.mock("@/lib/templateVersions", () => ({
  publishTemplateDraft: vi.fn(async (t: { id: string }) => {
    state.published.push(t.id);
    return { revisionId: "rev1", createdAt: "now" };
  }),
}));
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: state.page }) }) } }));
vi.mock("@/lib/db/coreEntities", () => ({ Member: {}, User: { get: () => ({ go: async () => ({ data: { name: "Owner" } }) }) } }));
vi.mock("@/lib/plan/sitesStore", () => ({
  listGovernedSites: async () => state.sites,
  setPagePublishFlags: vi.fn(async (id: string) => void state.republished.push(id)),
}));

import { POST as publishPage } from "@/app/api/templates/[id]/publish/route";
import { assertCanPutSiteLive, PlanLimitError } from "@/lib/plan/publishGuard";

function publish(id: string) {
  return publishPage(new NextRequest(`https://plexo.test/api/templates/${id}/publish`, { method: "POST" }), { params: Promise.resolve({ id }) });
}
const pageRow = (over: Record<string, unknown>) => ({ id: "p", organizationId: "org1", kind: "LANDING_PAGE", designJson: {}, compiledHtml: "", ...over });

beforeEach(() => {
  state.plan = "FREE";
  state.sites = [];
  state.published = [];
  state.republished = [];
});

describe("publishing a page (POST /api/templates/:id/publish)", () => {
  it("Free: rejects publishing a second page with PLAN_PAGE_LIMIT_EXCEEDED, and publishes nothing", async () => {
    state.page = pageRow({ id: "about", parentId: "home" });
    const res = await publish("about");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("PLAN_PAGE_LIMIT_EXCEEDED");
    expect(body.error).toMatch(/one page per site — your homepage/);
    expect(body.upgradeUrl).toBe("/dashboard/settings/subscription");
    expect(state.published).toEqual([]);
  });

  it("Free: the homepage itself publishes normally", async () => {
    state.page = pageRow({ id: "home" });
    const res = await publish("home");
    expect(res.status).toBe(200);
    expect(state.published).toEqual(["home"]);
  });

  it("Pro: any page publishes, and an unpublished page goes back on the site", async () => {
    state.plan = "PRO";
    state.page = pageRow({ id: "about", parentId: "home", isPublished: false });
    const res = await publish("about");
    expect(res.status).toBe(200);
    expect(state.published).toEqual(["about"]);
    expect(state.republished).toEqual(["about"]);
  });
});

describe("putting a site live at an address", () => {
  const live = (id: string, name: string) => ({ id, name, pages: [], domains: [{ id: `d-${id}`, templateId: id, domain: `${id}.plexopages.com`, type: "SUBDOMAIN" }] });
  const offline = (id: string) => ({ id, name: id, pages: [], domains: [{ id: `d-${id}`, templateId: id, domain: `${id}.plexopages.com`, type: "SUBDOMAIN", planDisabledAt: "x" }] });

  it("Free: a second live site is refused with PLAN_SITE_LIMIT_EXCEEDED, naming the live one", async () => {
    state.sites = [live("blog", "My Blog"), offline("shop")];
    const err = await assertCanPutSiteLive({ userId: "u1", subscriptionPlan: "FREE" }, "shop", "SUBDOMAIN").catch((e) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect(err.code).toBe("PLAN_SITE_LIMIT_EXCEEDED");
    expect(err.message).toMatch(/"My Blog" is live now/);
  });

  it("Free: another address for the site that's already live is fine", async () => {
    state.sites = [live("blog", "My Blog")];
    await expect(assertCanPutSiteLive({ userId: "u1", subscriptionPlan: "FREE" }, "blog", "SUBDOMAIN")).resolves.toBeUndefined();
  });

  it("Free: custom domains need an upgrade", async () => {
    const err = await assertCanPutSiteLive({ userId: "u1", subscriptionPlan: "FREE" }, "blog", "CUSTOM").catch((e) => e);
    expect(err.code).toBe("PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE");
  });

  it("Pro: no site limit", async () => {
    state.sites = [live("blog", "My Blog"), live("shop", "My Shop")];
    await expect(assertCanPutSiteLive({ userId: "u1", subscriptionPlan: "PRO" }, "new", "CUSTOM")).resolves.toBeUndefined();
  });
});
