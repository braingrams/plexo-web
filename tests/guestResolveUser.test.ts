import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const SITE = "11111111-1111-4111-8111-111111111111";
const PAGE = "33333333-3333-4333-8333-333333333333";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "org1";

const state = { role: "guest", access: { [SITE]: "editor" } as Record<string, string> };

vi.mock("@/server/authDynamo", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/db/coreEntities", () => ({
  User: { get: () => ({ go: async () => ({ data: { id: "u1", lastActiveAt: new Date().toISOString() } }) }) },
  ApiKey: { query: { byHashedKey: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/server/orgDynamo", () => ({
  ensureActiveOrganization: async () => ({ status: "resolved", organizationId: ORG, organizationName: "Org", role: state.role, siteAccess: state.access }),
}));
vi.mock("@/lib/plan/workspacePlan", () => ({ workspacePlan: async () => ({ subscriptionPlan: "STARTER", onTrial: false, customDomainLimit: null, manageLandingPagePublishing: false }) }));
vi.mock("@/lib/plan/entitlement", () => ({ planSyncAction: () => null }));
vi.mock("@/lib/plan/lifecycle", () => ({ syncPlanLifecycle: async () => {} }));
vi.mock("@/lib/activity", () => ({ describeActivity: () => "x" }));
// Pages belong to the site; OTHER is a different site of the same workspace.
vi.mock("@/lib/access/siteAccessStore", () => ({
  guestRoleForSite: async (access: Record<string, string>, id: string) => {
    const root = id === PAGE ? SITE : id;
    return access[root] ? { role: access[root], root } : null;
  },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

import { resolveUser } from "@/lib/auth/resolveUser";

const req = (path: string, method = "GET", search = "") => ({ nextUrl: { pathname: path, search }, method, headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => { state.role = "guest"; state.access = { [SITE]: "editor" }; });

describe("a member invited to specific sites", () => {
  it("acts with the role they were given on that site, for the site or any of its pages", async () => {
    expect((await resolveUser(req(`/api/v1/templates/${SITE}/files`, "PUT")))?.role).toBe("editor");
    expect((await resolveUser(req(`/api/templates/${PAGE}`, "PATCH")))?.role).toBe("editor");
    state.access = { [SITE]: "blogger" };
    expect((await resolveUser(req(`/api/blog/${SITE}/posts`, "POST")))?.role).toBe("blogger");
    state.access = { [SITE]: "viewer" };
    expect((await resolveUser(req(`/api/templates/${SITE}/pages`, "GET")))?.role).toBe("viewer");
  });
  it("is refused on any other site of the workspace", async () => {
    expect(await resolveUser(req(`/api/v1/templates/${OTHER}/files`, "GET"))).toBeNull();
    expect(await resolveUser(req(`/api/blog/${OTHER}/posts`, "GET"))).toBeNull();
  });
  it("is refused on everything that is not about one of their sites", async () => {
    for (const p of ["/api/org/invite", "/api/v1/domains", "/api/settings/api-keys", "/api/v1/sol/chat", "/api/v1/marketplace/templates", "/api/site-transfers"]) {
      expect(await resolveUser(req(p, "GET")), p).toBeNull();
    }
  });
  it("is refused on settings that need extra care, even on their own site", async () => {
    for (const p of [`/api/templates/${SITE}/transfer`, `/api/v1/templates/${SITE}/ssr-secrets`, `/api/v1/templates/${SITE}/redirects`, `/api/v1/commerce/${SITE}/settings`, `/api/site-layout/${SITE}/custom-code`, `/api/v1/templates/${SITE}/badge`]) {
      expect(await resolveUser(req(p, "PUT")), p).toBeNull();
    }
  });
  it("cannot delete the whole site, but can delete one of its pages", async () => {
    expect(await resolveUser(req(`/api/templates/${SITE}`, "DELETE"))).toBeNull();
    expect((await resolveUser(req(`/api/templates/${PAGE}`, "DELETE")))?.role).toBe("editor");
  });
  it("only sees their own sites in a list, and cannot create one", async () => {
    const list = await resolveUser(req("/api/templates", "GET"));
    expect(list?.role).toBe("guest");
    expect(list?.siteAccess).toEqual({ [SITE]: "editor" });
    expect(await resolveUser(req("/api/templates", "POST"))).toBeNull();
  });
  it("an ordinary member is not held back at all", async () => {
    state.role = "editor";
    state.access = {};
    const r = await resolveUser(req("/api/v1/domains", "GET"));
    expect(r?.role).toBe("editor");
    expect(r?.siteAccess).toBeNull();
  });
});
