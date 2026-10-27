import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Publishing a Strata prototype: one call creates the app + address, a repeat call updates the same app,
// and an unusable address is explained before any build starts.

const state = vi.hoisted(() => ({
  userId: "u1" as string | null,
  apps: [] as Array<{ id: string; name: string; organizationId: string; sourceType: string; strataProjectId?: string }>,
  domains: [] as Array<{ domain: string; organizationId: string; templateId: string }>,
  deploys: [] as any[],
  patched: [] as any[],
}));

vi.mock("@/lib/strata/caller", () => ({
  resolveStrataCaller: async () => (state.userId ? { userId: state.userId, organizationId: "org1", role: null, subscriptionPlan: "PRO", customDomainLimit: null, manageLandingPagePublishing: false } : null),
}));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/server/pagesDomain", () => ({ getPagesDomain: () => "plexopages.com" }));
vi.mock("@/lib/plan/publishGuard", () => ({ assertCanPutSiteLive: async () => undefined, PlanLimitError: class extends Error {}, planLimitResponse: () => new Response("plan", { status: 403 }) }));
vi.mock("@/server/requireTemplateScope", () => ({ requireTemplateScope: () => null }));
vi.mock("@/lib/db/coreEntities", () => ({ Member: { get: () => ({ go: async () => ({ data: null }) }) }, User: { get: () => ({ go: async () => ({ data: { name: "Ada" } }) }) } }));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    query: { byOrg: ({ organizationId }: any) => ({ go: async () => ({ data: state.apps.filter((a) => a.organizationId === organizationId) }) }) },
    patch: ({ id }: any) => ({ set: (v: any) => ({ go: async () => void state.patched.push({ id, ...v }) }) }),
  },
  PublishedDomain: { query: { byDomain: ({ domain }: any) => ({ go: async () => ({ data: state.domains.filter((d) => d.domain === domain) }) }) } },
}));
vi.mock("@/lib/sites/linkDomain", () => ({ SUBDOMAIN_REGEX: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, RESERVED_SUBDOMAINS: new Set(["admin", "www"]) }));
vi.mock("@/lib/projects/appAccess", () => ({
  readBody: async (r: NextRequest) => r.json(),
  appError: () => new Response("err", { status: 500 }),
}));
vi.mock("@/server/requirePermissionDynamo", () => ({ requirePermission: () => null }));
vi.mock("@/lib/projects/deploy", () => ({
  DeployError: class extends Error {},
  filesFromUpload: async () => [],
  deploy: async (_o: any, input: any) => {
    state.deploys.push(input);
    return { appId: input.appId ?? "app1", buildId: "b1", versionId: "v1", previewUrl: "https://p", statusUrl: "https://s", editorUrl: "https://e" };
  },
}));

import { POST } from "@/app/api/v1/strata/projects/[id]/publish/route";

const call = (body: unknown, id = "sp1") =>
  POST(new NextRequest("http://x/api/v1/strata/projects/sp1/publish", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const files = [{ path: "package.json", content: "{}" }];

beforeEach(() => {
  Object.assign(state, { userId: "u1", apps: [], domains: [], deploys: [], patched: [] });
});

describe("POST /api/v1/strata/projects/:id/publish", () => {
  it("needs a sign-in", async () => {
    state.userId = null;
    expect((await call({ files })).status).toBe(401);
  });

  it("creates the app, publishes with the address and links the Strata project", async () => {
    const res = await call({ files, name: "Shop", subdomain: "My-Shop" });
    expect(res.status).toBe(202);
    expect((await res.json()).created).toBe(true);
    expect(state.deploys[0]).toMatchObject({ appId: undefined, publish: true, subdomain: "my-shop" });
    expect(state.patched[0]).toMatchObject({ id: "app1", strataProjectId: "sp1" });
  });

  it("updates the same app on a repeat publish", async () => {
    state.apps.push({ id: "app9", name: "Shop", organizationId: "org1", sourceType: "REACT_PROJECT", strataProjectId: "sp1" });
    const res = await call({ files });
    expect((await res.json()).created).toBe(false);
    expect(state.deploys[0]).toMatchObject({ appId: "app9", publish: true });
    expect(state.patched).toHaveLength(0);
  });

  it("explains a taken, reserved or malformed address before building", async () => {
    state.domains.push({ domain: "taken.plexopages.com", organizationId: "other", templateId: "x" });
    const taken = await call({ files, subdomain: "taken" });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("subdomain_taken");
    expect((await call({ files, subdomain: "admin" })).status).toBe(409);
    expect((await call({ files, subdomain: "a.b.com" })).status).toBe(400);
    expect(state.deploys).toHaveLength(0);
  });

  it("asks for files", async () => {
    expect((await call({})).status).toBe(400);
  });
});
