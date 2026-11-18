import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

// A site's brand from Strata, live: the hosted sheet, the signed webhook, the sync, and serving it on every kind of page.

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  brands: new Map<string, Row>(),
  mappings: new Map<string, Row>(),
  hooks: new Map<string, Row>(),
  sites: new Map<string, Row>(),
  sheets: new Map<string, string>(),
  systems: new Map<string, any>(),
  rebuilt: [] as string[],
  pending: [] as Array<() => Promise<void>>,
  userToken: "user-session" as string | null,
}));

function patchable(map: Map<string, Row>, keyOf: (k: Record<string, string>) => string) {
  return (k: Record<string, string>) => {
    let set: Row = {};
    let remove: string[] = [];
    const b: any = {
      set: (v: Row) => ((set = { ...set, ...v }), b),
      remove: (v: string[]) => ((remove = v), b),
      where: () => b,
      go: async () => {
        const id = keyOf(k);
        const row = map.get(id);
        if (!row) throw new Error("missing");
        if ("runningAt" in set && row.runningAt && Date.now() - new Date(row.runningAt).getTime() < 600_000) throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
        const next = { ...row, ...set };
        for (const r of remove) delete next[r];
        map.set(id, next);
      },
    };
    return b;
  };
}

vi.mock("@/lib/db/coreEntities", () => ({
  SiteBrand: {
    get: ({ siteId }: { siteId: string }) => ({ go: async () => ({ data: state.brands.get(siteId) ?? null }) }),
    upsert: (item: Row) => ({ go: async () => void state.brands.set(item.siteId, { ...state.brands.get(item.siteId), ...item }) }),
    delete: ({ siteId }: { siteId: string }) => ({ go: async () => void state.brands.delete(siteId) }),
    patch: patchable(state.brands, (k) => k.siteId),
    query: { byStrataProject: ({ strataProjectId }: { strataProjectId: string }) => ({ go: async () => ({ data: [...state.brands.values()].filter((r) => r.strataProjectId === strataProjectId), cursor: null }) }) },
    scan: { where: () => ({ go: async () => ({ data: [...state.brands.values()].filter((r) => r.status === "active" && r.autoSync !== false), cursor: null }) }) },
  },
  SiteBrandMapping: {
    get: ({ siteId }: { siteId: string }) => ({ go: async () => ({ data: state.mappings.get(siteId) ?? null }) }),
    upsert: (item: Row) => ({ go: async () => void state.mappings.set(item.siteId, item) }),
    patch: patchable(state.mappings, (k) => k.siteId),
  },
  StrataProjectWebhook: {
    get: ({ strataProjectId }: { strataProjectId: string }) => ({ go: async () => ({ data: state.hooks.get(strataProjectId) ?? null }) }),
    upsert: (item: Row) => ({ go: async () => void state.hooks.set(item.strataProjectId, item) }),
    delete: ({ strataProjectId }: { strataProjectId: string }) => ({ go: async () => void state.hooks.delete(strataProjectId) }),
    patch: patchable(state.hooks, (k) => k.strataProjectId),
  },
}));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: state.sites.get(id) ?? null }) }) },
  TemplateAsset: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => state.userToken }));
vi.mock("@/lib/siteLayoutCore", () => ({ recompileSiteLayoutDependents: async (id: string) => void state.rebuilt.push(id) }));


const x = vi.hoisted(() => ({
  applied: [] as string[],
  applyFails: false,
  placed: true,
  uploads: [] as Array<Record<string, unknown>>,
  order: [] as string[],
}));
vi.mock("@/lib/sites/applyLook", () => ({
  applySiteLogo: async (i: { logoUrl: string }) => {
    if (x.applyFails) throw new Error("boom");
    x.applied.push(i.logoUrl);
    return { placed: x.placed };
  },
}));
vi.mock("@/lib/brand/resolveSiteBrand", () => ({
  resolveSiteBrand: async () => ({ linked: false, colours: [{ role: "primary", value: "#112233" }], fonts: {}, logoUrl: "https://plexo.test/logo.png" }),
}));
vi.mock("@/lib/siteImport/fetchSafe", () => ({ safeFetch: async () => new Response(new Blob(["x"], { type: "image/png" })) }));
vi.mock("@charisol/plexo-sdk/v2/strata", async (orig) => ({
  ...(await orig<typeof import("@charisol/plexo-sdk/v2/strata")>()),
  createStrataClient: () => ({
    listProjects: async () => [],
    listAssets: async () => [],
    createProject: async (i: { name: string }) => (x.order.push("create"), { id: "p9", name: i.name }),
    pull: async () => ({ revision: "r0", tokens: [], components: [] }),
    push: async () => ({}),
    uploadAsset: async (_id: string, a: Record<string, unknown>) => void (x.order.push("upload"), x.uploads.push(a)),
  }),
}));

import { setBrandBackend } from "@/lib/brand/store";
import { createStrataProjectFromSiteBrand, getSiteBrandState, parseStrataLogo, publishStrataProject, runSiteBrandUpdate, syncProjectLogo, forgetServingMemo } from "@/lib/brand/siteBrand";
import { encryptStrataToken } from "@/lib/crypto";

const KEY = "strata_ik_0123456789abcdef_" + "A".repeat(43);
const SECRET = "whsec_" + "s".repeat(43);
const strataToken = (t: any) => ({ key: t.key, name: t.name, value: t.value, type: t.type, unit: t.unit, layer: t.layer, comment: t.comment });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let remote = { revision: "r1", tokens: [] as any[], components: [] as any[], published: true, logo: undefined as unknown, publish: 200 as number, unchanged: false };
const calls: Array<{ method: string; url: string; auth: string | null; body?: any }> = [];

function seedSite(id: string, extra: Row = {}) {
  state.sites.set(id, { id, name: `Site ${id}`, organizationId: "org1", sourceType: "BUILDER", ...extra });
}
function seedBrand(siteId: string, extra: Row = {}) {
  state.brands.set(siteId, { siteId, organizationId: "org1", userId: "u1", strataProjectId: "p1", keyId: "k1", ciphertext: encryptStrataToken(KEY), autoSync: true, status: "active", revision: "old", strataRevision: "r0", createdAt: "2026-01-01T00:00:00.000Z", ...extra });
}

beforeEach(() => {
  process.env.STRATA_API_URL = "https://strata.test/v1";
  process.env.STRATA_TOKEN_ENCRYPTION_SECRET = "test-secret-for-strata-tokens";
  process.env.NEXT_PUBLIC_APP_URL = "https://plexo.test";
  for (const m of [state.brands, state.mappings, state.hooks, state.sites, state.sheets, state.systems]) m.clear();
  state.rebuilt.length = 0;
  state.pending.length = 0;
  state.userToken = "user-session";
  calls.length = 0;
  forgetServingMemo();
  const ds = createDefaultDesignSystem();
  remote = { revision: "r1", tokens: ds.tokens.map(strataToken), components: ds.components, published: true, logo: undefined, publish: 200, unchanged: false };
  x.applied.length = 0;
  x.applyFails = false;
  x.placed = true;
  x.uploads.length = 0;
  x.order.length = 0;
  setBrandBackend({
    putSheet: async (id, css) => void state.sheets.set(id, css),
    getSheet: async (id) => state.sheets.get(id) ?? null,
    putDesignSystem: async (id, d) => void state.systems.set(id, d),
    getDesignSystem: async (id) => state.systems.get(id) ?? null,
    remove: async (id) => void (state.sheets.delete(id), state.systems.delete(id)),
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string>)?.Authorization ?? null;
    calls.push({ method, url, auth, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/integration-keys") && method === "POST") return json(201, { data: { keyId: "k1", key: KEY } });
    if (url.includes("/integration-keys/") && method === "DELETE") return json(200, { data: {} });
    if (url.endsWith("/webhooks") && method === "POST") return json(201, { data: { webhookId: "wh1", secret: SECRET } });
    if (url.includes("/webhooks/") && method === "DELETE") return json(200, { data: {} });
    if (url.endsWith("/design-system/publish") && method === "POST") {
      x.order.push("publish");
      if (remote.publish === 200) {
        if (!remote.unchanged) remote.published = true;
        return json(200, { data: { published: !remote.unchanged, unchanged: remote.unchanged, version: 1 } });
      }
      return json(remote.publish, { error: { code: "X" } });
    }
    if (url.includes("/design-system/revision")) {
      if (!remote.published) return json(404, { error: { code: "NOT_PUBLISHED" } });
      return json(200, { data: { revision: remote.revision, ...(remote.logo !== undefined ? { logo: remote.logo } : {}) } });
    }
    if (url.includes("/design-system")) {
      if (url.includes("source=published") && !remote.published) return json(404, { error: { code: "NOT_PUBLISHED" } });
      return json(200, { data: { revision: remote.revision, variables: remote.tokens, components: remote.components, ...(remote.logo !== undefined ? { logo: remote.logo } : {}) } });
    }
    return json(404, {});
  });
});


const L1 = "https://cdn.strata.test/p1/a1/logo.png";
const L2 = "https://cdn.strata.test/p1/a2/logo.png";
const owner = { siteId: "s1", userId: "u1", organizationId: "org1" };

function linkedSite(extra: Row = {}) {
  seedSite("s1");
  state.systems.set("s1", createDefaultDesignSystem());
  seedBrand("s1", { projectLogo: L1, projectLogoId: "a1", ...extra });
  remote.revision = "r0"; // the revision the row already has
}

describe("publishing a project Plexo made", () => {
  it("publishStrataProject maps Strata's answers: published, unchanged, unavailable (404/405/5xx), refused (403/400)", async () => {
    expect(await publishStrataProject("tok", "p1")).toBe("published");
    remote.unchanged = true;
    expect(await publishStrataProject("tok", "p1")).toBe("unchanged");
    for (const status of [404, 405, 502]) {
      remote.publish = status;
      expect(await publishStrataProject("tok", "p1")).toBe("unavailable");
    }
    for (const status of [403, 400, 401]) {
      remote.publish = status;
      expect(await publishStrataProject("tok", "p1")).toBe("refused");
    }
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(await publishStrataProject("tok", "p1")).toBe("unavailable");
    const call = calls[0];
    expect(call).toMatchObject({ method: "POST", auth: "Bearer tok" });
    expect(call.url).toBe("https://strata.test/v1/projects/p1/design-system/publish");
  });

  it("uploads the logo as type LOGO / role PRIMARY (Strata's real values), then publishes, then links to the PUBLISHED brand", async () => {
    seedSite("s1");
    const r = await createStrataProjectFromSiteBrand(owner);
    expect(x.uploads).toHaveLength(1);
    expect(x.uploads[0]).toMatchObject({ type: "LOGO", role: "PRIMARY" });
    expect(x.order).toEqual(["create", "upload", "publish"]);
    // published with the owner's own session, not the read-only key
    expect(calls.find((c) => c.url.endsWith("/design-system/publish"))?.auth).toBe("Bearer user-session");
    expect(calls.some((c) => c.url.includes("source=published") && c.auth === `Bearer ${KEY}`)).toBe(true);
    expect(r.state.awaitingPublish).toBe(false);
    expect(r.notes).toEqual([]);
    expect(state.brands.get("s1")).toMatchObject({ plexoCreated: true, awaitingPublish: false });
    expect(state.brands.get("s1")!.lastResult).toMatch(/stays in sync/);
  });

  it("an old Strata without the endpoint (404): the site is linked anyway and waits for the owner's Publish, in plain words", async () => {
    seedSite("s1");
    remote.publish = 404;
    remote.published = false;
    const r = await createStrataProjectFromSiteBrand(owner);
    expect(r.state).toMatchObject({ linked: true, awaitingPublish: true });
    expect(r.notes).toContain("Your brand is saved in Strata. Press Publish there once to start keeping it in sync.");
    const s = await getSiteBrandState("s1");
    expect(s.lastResult).toBe("Your brand is saved in Strata. Press Publish there once to start keeping it in sync.");
    expect(s.lastResultKind).toBe("updated");
    expect(state.brands.get("s1")).toMatchObject({ plexoCreated: true, awaitingPublish: true });
  });

  it("a refused publish (403) is the same: linked, waiting, never an error", async () => {
    seedSite("s1");
    remote.publish = 403;
    remote.published = false;
    const r = await createStrataProjectFromSiteBrand(owner);
    expect(r.state.linked).toBe(true);
    expect(r.state.awaitingPublish).toBe(true);
    expect(r.state.lastResultKind).not.toBe("error");
  });

  it("the next refresh retries the publish; when it works the site follows and the waiting note goes", async () => {
    linkedSite({ plexoCreated: true, awaitingPublish: true, strataRevision: undefined });
    remote.published = false;
    remote.publish = 404;
    let r = await runSiteBrandUpdate("s1", { source: "schedule" });
    expect(r.outcome).toBe("up-to-date");
    expect(r.message).toMatch(/Press Publish there once/);
    expect(state.brands.get("s1")!.awaitingPublish).toBe(true);
    expect(x.order.filter((o) => o === "publish")).toHaveLength(1);

    remote.publish = 200; // this Strata now has the endpoint
    r = await runSiteBrandUpdate("s1", { source: "schedule" });
    expect(x.order.filter((o) => o === "publish")).toHaveLength(2);
    expect(["updated", "up-to-date"]).toContain(r.outcome);
    expect(state.brands.get("s1")!.awaitingPublish).toBe(false);
  });

  it("a project the owner linked themselves is never published by Plexo", async () => {
    linkedSite({ plexoCreated: false, awaitingPublish: true });
    remote.published = false;
    const r = await runSiteBrandUpdate("s1", { source: "schedule" });
    expect(r.outcome).toBe("up-to-date");
    expect(x.order).not.toContain("publish");
  });

  it("someone pressing Publish in Strata clears the waiting state on its own", async () => {
    linkedSite({ plexoCreated: false, awaitingPublish: true, strataRevision: "r0" });
    remote.revision = "r1";
    await runSiteBrandUpdate("s1", { source: "webhook", revision: "r1" });
    expect(state.brands.get("s1")!.awaitingPublish).toBe(false);
  });
});

describe("a logo replaced in Strata after linking", () => {
  it("is noticed on the cheap revision read, saved on the row, applied to the site once, and reported in words", async () => {
    linkedSite();
    remote.logo = { assetId: "a2", url: L2, mimeType: "image/png" };
    const r = await runSiteBrandUpdate("s1", { source: "schedule" });
    expect(r.outcome).toBe("updated");
    expect(r.message).toMatch(/new logo/i);
    expect(x.applied).toEqual([L2]);
    expect(state.brands.get("s1")).toMatchObject({ projectLogo: L2, projectLogoId: "a2", lastResultKind: "updated" });
    // only the small revision read: nothing downloaded, the sheet untouched
    expect(calls.map((c) => c.url)).toEqual([expect.stringContaining("/design-system/revision?source=published")]);
    expect(state.sheets.has("s1")).toBe(false);
    // and again: nothing to do
    x.applied.length = 0;
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(x.applied).toEqual([]);
  });

  it("a publish webhook that only changed the logo (same revision) still updates it", async () => {
    linkedSite();
    remote.logo = { assetId: "a2", url: L2 };
    const r = await runSiteBrandUpdate("s1", { source: "webhook", revision: "r0" });
    expect(r.outcome).toBe("updated");
    expect(state.brands.get("s1")!.projectLogo).toBe(L2);
  });

  it("travels with a real design-system change too (full pull)", async () => {
    linkedSite();
    remote.revision = "r2";
    remote.tokens = remote.tokens.map((t: any) => (t.key === "--color-brand-primary-500" ? { ...t, value: "#E11D48" } : t));
    remote.logo = { assetId: "a2", url: L2 };
    const r = await runSiteBrandUpdate("s1", { source: "webhook", revision: "r2" });
    expect(r.outcome).toBe("updated");
    expect(state.sheets.get("s1")).toContain("#E11D48");
    expect(r.message).toMatch(/new logo/i);
    expect(state.brands.get("s1")).toMatchObject({ projectLogo: L2, projectLogoId: "a2", strataRevision: "r2" });
  });

  it("an unchanged logo is a no-op: no site writes, only the check time moves", async () => {
    linkedSite({ lastResult: "before" });
    remote.logo = { assetId: "a1", url: L1 };
    const r = await runSiteBrandUpdate("s1", { source: "schedule" });
    expect(r.outcome).toBe("unchanged");
    expect(x.applied).toEqual([]);
    expect(state.brands.get("s1")).toMatchObject({ projectLogo: L1, lastResult: "before" });
  });

  it("a Strata that reports no logo (or an older one that doesn't) leaves the site's logo alone", async () => {
    linkedSite();
    remote.logo = null;
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    remote.logo = undefined;
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(state.brands.get("s1")!.projectLogo).toBe(L1);
    expect(x.applied).toEqual([]);
  });

  it("a row linked before logo ids were stored just learns the id, without touching the site", async () => {
    linkedSite({ projectLogoId: undefined });
    remote.logo = { assetId: "a1", url: L1 };
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(state.brands.get("s1")!.projectLogoId).toBe("a1");
    expect(x.applied).toEqual([]);
  });

  it("a legacy row with NO recorded logo: Strata's logo becomes the baseline, and nothing is applied to the site", async () => {
    linkedSite({ projectLogo: undefined, projectLogoId: undefined });
    remote.logo = { assetId: "a1", url: L1 };
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(x.applied).toEqual([]);
    expect(state.brands.get("s1")!.projectLogo).toBe(L1);
    expect(state.brands.get("s1")!.projectLogoId).toBe("a1");
    // ...and the same through a full pull (a publish with new tokens): still nothing applied to the header.
    linkedSite({ projectLogo: undefined, projectLogoId: undefined });
    const direct = await syncProjectLogo({ id: "s1", name: "S", organizationId: "org1", sourceType: "LANDING_PAGE" }, state.brands.get("s1") as any, { assetId: "a1", url: L1 });
    expect(direct.changed).toBe(false);
    expect(x.applied).toEqual([]);
  });

  it("a recorded logo that differs is applied once; the same logo is left alone", async () => {
    linkedSite();
    remote.logo = { assetId: "a1", url: L1 };
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(x.applied).toEqual([]);
    remote.logo = { assetId: "a2", url: L2 };
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("updated");
    expect(x.applied.length).toBe(1);
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(x.applied.length).toBe(1);
  });

  it("a failed apply isn't recorded as done, so the next sync tries again", async () => {
    linkedSite();
    remote.logo = { assetId: "a2", url: L2 };
    x.applyFails = true;
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("unchanged");
    expect(state.brands.get("s1")!.projectLogo).toBe(L1);
    x.applyFails = false;
    expect((await runSiteBrandUpdate("s1", { source: "schedule" })).outcome).toBe("updated");
    expect(state.brands.get("s1")!.projectLogo).toBe(L2);
  });

  it("a site with no V2 header still records the logo (new pages and SOL read it) and says so honestly", async () => {
    linkedSite();
    x.placed = false;
    remote.logo = { assetId: "a2", url: L2 };
    const r = await runSiteBrandUpdate("s1", { source: "schedule" });
    expect(r.message).toMatch(/new pages/);
    expect(state.brands.get("s1")!.projectLogo).toBe(L2);
  });

  it("an app's logo is recorded but its files are not touched by the header apply", async () => {
    seedSite("s1", { sourceType: "REACT_PROJECT" });
    state.systems.set("s1", createDefaultDesignSystem());
    seedBrand("s1", { projectLogo: L1, projectLogoId: "a1" });
    remote.revision = "r0";
    remote.logo = { assetId: "a2", url: L2 };
    const site = { id: "s1", name: "S", organizationId: "org1", sourceType: "REACT_PROJECT" };
    const r = await syncProjectLogo(site, state.brands.get("s1") as any, { assetId: "a2", url: L2 });
    expect(r.changed).toBe(true);
    expect(x.applied).toEqual([]);
  });

  it("parseStrataLogo accepts only https addresses and tells 'none' from 'not reported'", () => {
    expect(parseStrataLogo(undefined)).toBeUndefined();
    expect(parseStrataLogo(null)).toBeNull();
    expect(parseStrataLogo({ url: "http://x/a.png" })).toBeNull();
    expect(parseStrataLogo({ url: L1, assetId: "a1", mimeType: "image/png" })).toEqual({ url: L1, assetId: "a1" });
  });
});
