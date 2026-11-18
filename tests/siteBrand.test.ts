import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

// A site's brand from Strata, live: the hosted sheet, the signed webhook, the sync, and serving it on every kind of page.

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  brands: new Map<string, Row>(),
  mappings: new Map<string, Row>(),
  hooks: new Map<string, Row>(),
  sites: new Map<string, Row>(),
  deployed: new Map<string, Row>(),
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
vi.mock("@/lib/db/appEntities", () => ({ DeployedApp: { get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: state.deployed.get(templateId) ?? null }) }) } }));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => state.userToken }));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "org1", role: null }) }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/lib/siteLayoutCore", () => ({ recompileSiteLayoutDependents: async (id: string) => void state.rebuilt.push(id) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => void state.pending.push(fn) }));

import { setBrandBackend } from "@/lib/brand/store";
import { signStrataPayload, verifyStrataSignature } from "@/lib/brand/webhookSignature";
import { applyPublishedEvent, brandForServing, setSiteBrandOptions, getSiteBrandState, linkSiteBrand, runAllSiteBrandSyncs, runSiteBrandUpdate, sitesForProject, unlinkSiteBrand, writeBrandSheet, forgetServingMemo } from "@/lib/brand/siteBrand";
import { applyBrandMappingToCss, applyBrandMappingToHtml, computeBrandMapping, normalizeColor } from "@/lib/brand/mapping";
import { applySiteBrandToHtml, brandLinkTag, insertBrandLink } from "@/lib/brand/inject";
import { POST as webhookRoute } from "@/app/api/v1/strata/webhook/route";
import { GET as sheetRoute } from "@/app/api/public/brand/[file]/route";
import { encryptStrataToken } from "@/lib/crypto";

const KEY = "strata_ik_0123456789abcdef_" + "A".repeat(43);
const SECRET = "whsec_" + "s".repeat(43);
const strataToken = (t: any) => ({ key: t.key, name: t.name, value: t.value, type: t.type, unit: t.unit, layer: t.layer, comment: t.comment });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let remote = { revision: "r1", tokens: [] as any[], components: [] as any[], published: true };
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
  for (const m of [state.brands, state.mappings, state.hooks, state.sites, state.deployed, state.sheets, state.systems]) m.clear();
  state.rebuilt.length = 0;
  state.pending.length = 0;
  state.userToken = "user-session";
  calls.length = 0;
  forgetServingMemo();
  const ds = createDefaultDesignSystem();
  remote = { revision: "r1", tokens: ds.tokens.map(strataToken), components: ds.components, published: true };
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
    if (url.includes("/design-system/revision")) return json(200, { data: { revision: remote.revision } });
    if (url.includes("/design-system")) {
      if (url.includes("source=published") && !remote.published) return json(404, { error: { code: "NOT_PUBLISHED" } });
      return json(200, { data: { revision: remote.revision, variables: remote.tokens, components: remote.components } });
    }
    return json(404, {});
  });
});

// ------------------------------------------------------------------------------------------------ signatures
describe("Strata webhook signatures", () => {
  const body = JSON.stringify({ id: "d1", type: "design-system.published", projectId: "p1", data: { revision: "r2" } });
  const ts = String(Math.floor(Date.now() / 1000));

  it("matches Strata's own format: v1=hex HMAC-SHA256 of `${timestamp}.${body}`, keyed by the whole secret", () => {
    const expected = `v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
    expect(signStrataPayload(SECRET, ts, body)).toBe(expected);
    expect(verifyStrataSignature({ secret: SECRET, timestamp: ts, signature: expected, rawBody: body })).toEqual({ ok: true });
  });

  it("refuses a changed body, the wrong secret, an old timestamp, and missing headers", () => {
    const sig = signStrataPayload(SECRET, ts, body);
    expect(verifyStrataSignature({ secret: SECRET, timestamp: ts, signature: sig, rawBody: body + " " }).ok).toBe(false);
    expect(verifyStrataSignature({ secret: "whsec_other", timestamp: ts, signature: sig, rawBody: body }).ok).toBe(false);
    const old = String(Number(ts) - 3600);
    expect(verifyStrataSignature({ secret: SECRET, timestamp: old, signature: signStrataPayload(SECRET, old, body), rawBody: body })).toEqual({ ok: false, reason: "stale" });
    expect(verifyStrataSignature({ secret: SECRET, timestamp: null, signature: sig, rawBody: body })).toEqual({ ok: false, reason: "missing" });
  });

  it("accepts any one of several signatures (a secret being rotated)", () => {
    const sig = signStrataPayload(SECRET, ts, body);
    expect(verifyStrataSignature({ secret: SECRET, timestamp: ts, signature: `v1=deadbeef, ${sig}`, rawBody: body }).ok).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ the sheet
describe("the hosted brand sheet", () => {
  it("is written from the design system, and its revision follows its content", async () => {
    const ds = createDefaultDesignSystem();
    const r1 = await writeBrandSheet("s1", ds);
    expect(state.sheets.get("s1")).toContain("--color-brand-primary-500:#266DDC");
    expect(state.sheets.get("s1")).toContain(".plx-brand-button");
    const same = await writeBrandSheet("s1", ds);
    expect(same).toBe(r1);
    const changed = await writeBrandSheet("s1", { ...ds, tokens: ds.tokens.map((t) => (t.key === "--color-brand-primary-500" ? { ...t, value: "#E11D48" } : t)) });
    expect(changed).not.toBe(r1);
    expect(state.sheets.get("s1")).toContain("#E11D48");
  });

  it("is served with short caching, and an unbranded site gets an empty sheet instead of an error", async () => {
    state.sheets.set("s1", ":root{--a:red}");
    const ok = await sheetRoute(new NextRequest("https://x.test/api/public/brand/s1.css"), { params: Promise.resolve({ file: "s1.css" }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    expect(await ok.text()).toBe(":root{--a:red}");
    const none = await sheetRoute(new NextRequest("https://x.test/api/public/brand/s2.css"), { params: Promise.resolve({ file: "s2.css" }) });
    expect(none.status).toBe(200);
    const bad = await sheetRoute(new NextRequest("https://x.test/api/public/brand/x"), { params: Promise.resolve({ file: "../etc.css" }) });
    expect(bad.status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ link / unlink
describe("linking a site to a Strata brand", () => {
  it("makes a read-only key, pulls the PUBLISHED brand, writes the sheet, subscribes once, and rebuilds the pages once", async () => {
    seedSite("s1");
    const s = await linkSiteBrand({ siteId: "s1", userId: "u1", organizationId: "org1", projectId: "p1", projectName: "Acme" });
    expect(s).toMatchObject({ linked: true, projectName: "Acme", autoSync: true, status: "active" });
    expect(calls.some((c) => c.url.includes("/design-system?source=published") && c.auth === `Bearer ${KEY}`)).toBe(true);
    expect(state.sheets.get("s1")).toContain("--color-brand-primary-500");
    const sub = calls.find((c) => c.url.endsWith("/projects/p1/webhooks"));
    expect(sub?.body).toMatchObject({ url: "https://plexo.test/api/v1/strata/webhook", events: ["design-system.published"] });
    expect(state.hooks.get("p1")?.webhookId).toBe("wh1");
    expect(state.hooks.get("p1")?.secretCiphertext).not.toContain(SECRET);
    expect(state.rebuilt).toEqual(["s1"]);
    // A second site on the same project shares the subscription.
    seedSite("s2");
    await linkSiteBrand({ siteId: "s2", userId: "u1", organizationId: "org1", projectId: "p1" });
    expect(calls.filter((c) => c.url.endsWith("/webhooks") && c.method === "POST")).toHaveLength(1);
  });

  it("uses the latest saved version of a never-published project, and says so", async () => {
    seedSite("s1");
    remote.published = false;
    const s = await linkSiteBrand({ siteId: "s1", userId: "u1", organizationId: "org1", projectId: "p1" });
    expect(s.lastResult).toMatch(/Press Publish there once/);
    expect(s.awaitingPublish).toBe(true);
  });

  it("explains a missing Strata sign-in in plain words, and refuses another organisation's site", async () => {
    seedSite("s1");
    state.userToken = null;
    await expect(linkSiteBrand({ siteId: "s1", userId: "u1", organizationId: "org1", projectId: "p1" })).rejects.toThrow(/Connect Strata first/);
    state.userToken = "user-session";
    await expect(linkSiteBrand({ siteId: "s1", userId: "u1", organizationId: "other", projectId: "p1" })).rejects.toThrow(/Site not found/);
  });

  it("unlinking revokes the key, removes the sheet, and drops the subscription when no site uses the project", async () => {
    seedSite("s1");
    await linkSiteBrand({ siteId: "s1", userId: "u1", organizationId: "org1", projectId: "p1" });
    const s = await unlinkSiteBrand({ siteId: "s1", userId: "u1" });
    expect(s.linked).toBe(false);
    expect(state.sheets.has("s1")).toBe(false);
    expect(state.hooks.has("p1")).toBe(false);
    expect(calls.some((c) => c.url.includes("/integration-keys/k1") && c.method === "DELETE")).toBe(true);
    expect(calls.some((c) => c.url.includes("/webhooks/wh1") && c.method === "DELETE")).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ the sync
describe("keeping a site in sync", () => {
  function linkedSite(id = "s1") {
    seedSite(id);
    const ds = createDefaultDesignSystem();
    state.systems.set(id, ds);
    seedBrand(id);
    return ds;
  }

  it("finds every site linked to a project", async () => {
    seedBrand("a");
    seedBrand("b");
    seedBrand("c", { strataProjectId: "p2" });
    expect((await sitesForProject("p1")).map((r) => r.siteId).sort()).toEqual(["a", "b"]);
  });

  it("a token-only change regenerates the sheet and does NOT rebuild any page", async () => {
    linkedSite();
    remote.revision = "r2";
    remote.tokens = remote.tokens.map((t) => (t.key === "--color-brand-primary-500" ? { ...t, value: "#E11D48" } : t));
    const r = await runSiteBrandUpdate("s1", { source: "webhook", revision: "r2" });
    expect(r.outcome).toBe("updated");
    expect(state.sheets.get("s1")).toContain("--color-brand-primary-500:#E11D48");
    expect(state.rebuilt).toEqual([]);
    expect(state.brands.get("s1")).toMatchObject({ strataRevision: "r2", lastResultKind: "updated", lastSource: "webhook" });
    expect(state.brands.get("s1")!.revision).not.toBe("old");
    expect(state.brands.get("s1")!.lastResult).toMatch(/when it was published/);
  });

  it("a component change also rebuilds the pages that have components written into them", async () => {
    linkedSite();
    remote.revision = "r2";
    remote.components = remote.components.map((c: any, i: number) => (i === 0 ? { ...c, nodes: [{ ...c.nodes[0], properties: { ...c.nodes[0].properties, "border-radius": { value: "var(--radius-full)" } } }] } : c));
    expect((await runSiteBrandUpdate("s1", { source: "webhook", revision: "r2" })).outcome).toBe("updated");
    expect(state.rebuilt).toEqual(["s1"]);
  });

  it("a revision already applied stops after one small revision read (nothing downloaded); a switched-off site is left alone", async () => {
    linkedSite();
    remote.revision = "r0";
    expect((await runSiteBrandUpdate("s1", { source: "webhook", revision: "r0" })).outcome).toBe("unchanged");
    expect(calls.map((c) => c.url)).toEqual([expect.stringContaining("/design-system/revision?source=published")]);
    state.brands.get("s1")!.autoSync = false;
    expect((await runSiteBrandUpdate("s1", { source: "webhook", revision: "r9" })).outcome).toBe("skipped");
  });

  it("a key Strata no longer accepts asks the owner to link again, in plain words", async () => {
    linkedSite();
    vi.stubGlobal("fetch", async () => json(401, {}));
    expect((await runSiteBrandUpdate("s1", { source: "webhook" })).outcome).toBe("needs-reconnect");
    const s = await getSiteBrandState("s1");
    expect(s.status).toBe("needs-reconnect");
    expect(s.lastResult).toMatch(/Link it again/);
  });

  it("a published event updates every linked site that keeps in sync", async () => {
    linkedSite("a");
    linkedSite("b");
    linkedSite("c");
    state.brands.get("c")!.autoSync = false;
    remote.revision = "r2";
    remote.tokens = remote.tokens.map((t) => (t.key === "--color-brand-primary-500" ? { ...t, value: "#E11D48" } : t));
    expect(await applyPublishedEvent("p1", "r2")).toEqual({ updated: 2 });
    expect(state.sheets.get("c")).toBeUndefined();
  });

  it("the scheduled fallback checks the small revision first and re-subscribes a project with no webhook", async () => {
    linkedSite();
    remote.revision = "r0";
    const out = await runAllSiteBrandSyncs();
    expect(out.counts).toEqual({ unchanged: 1 });
    expect(calls.some((c) => c.url.includes("/design-system/revision?source=published"))).toBe(true);
    expect(state.hooks.get("p1")?.createdWith).toBe("k1");
  });
});

// ------------------------------------------------------------------------------------------------ the webhook route
describe("POST /api/v1/strata/webhook", () => {
  const send = (body: Row, opts: { secret?: string; event?: string; delivery?: string; ts?: number } = {}) => {
    const raw = JSON.stringify(body);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    return webhookRoute(
      new NextRequest("https://plexo.test/api/v1/strata/webhook", {
        method: "POST",
        body: raw,
        headers: { "content-type": "application/json", "x-strata-event": opts.event ?? body.type, "x-strata-delivery": opts.delivery ?? body.id, "x-strata-timestamp": ts, "x-strata-signature": signStrataPayload(opts.secret ?? SECRET, ts, raw) },
      }),
    );
  };
  const published = (revision = "r2", id = "d1") => ({ id, type: "design-system.published", createdAt: new Date().toISOString(), projectId: "p1", data: { revision, version: 3, message: null } });

  beforeEach(() => {
    state.hooks.set("p1", { strataProjectId: "p1", webhookId: "wh1", secretCiphertext: encryptStrataToken(SECRET), createdWith: "session", createdAt: "2026-01-01" });
    seedSite("s1");
    state.systems.set("s1", createDefaultDesignSystem());
    seedBrand("s1");
  });

  it("verifies the signature, answers straight away, then applies the publish to the linked sites", async () => {
    remote.revision = "r2";
    remote.tokens = remote.tokens.map((t) => (t.key === "--color-brand-primary-500" ? { ...t, value: "#E11D48" } : t));
    const res = await send(published());
    expect(res.status).toBe(202);
    expect(state.sheets.get("s1")).toBeUndefined(); // not yet: it runs after the answer
    for (const job of state.pending) await job();
    expect(state.sheets.get("s1")).toContain("#E11D48");
  });

  it("refuses a bad signature, ignores autosave events, and 404s an unknown project", async () => {
    expect((await send(published(), { secret: "whsec_wrong" })).status).toBe(401);
    const autosave = await send({ ...published(), type: "design-system.updated" });
    expect(autosave.status).toBe(202);
    expect(await autosave.json()).toMatchObject({ ignored: "design-system.updated" });
    expect(state.pending).toHaveLength(0);
    expect((await send({ ...published(), projectId: "nope" })).status).toBe(404);
    expect((await send(published(), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
  });

  it("acknowledges a repeated delivery without doing the work twice", async () => {
    await send(published("r2", "same"));
    const again = await send(published("r2", "same"));
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(state.pending).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ raw HTML / WordPress
const WP_HTML = `<!doctype html><html><head><style>
:root{--theme-accent:#1A73E8}
body{color:#222222;background-color:#ffffff;font-family:'Open Sans',Arial,sans-serif}
h1,h2,.entry-title{font-family:"Playfair Display",serif;color:#222222}
.button,.wp-block-button__link{background-color:#1a73e8;color:#fff;border:2px solid #1A73E8}
.badge{background:rgb(233, 30, 99)}
.footer{background-color:#ffffff;color:#222}
a{color:#1a73e8}
</style></head><body><h1 class="entry-title">Hi</h1><a class="button" style="background-color:#1a73e8;color:#fff">Donate</a><span class="badge">New</span><script>var c="#1a73e8";</script></body></html>`;

describe("matching a raw/WordPress site's own colours and fonts to the brand", () => {
  it("finds text, background, brand colours and fonts", () => {
    const m = computeBrandMapping(WP_HTML);
    expect(m.colors["#222222"]).toBe("--color-text-primary");
    expect(m.colors["#ffffff"]).toBe("--color-bg-canvas");
    expect(m.colors["#1a73e8"]).toBe("--color-brand-primary-500");
    expect(m.colors["#e91e63"]).toBe("--color-brand-secondary-500");
    expect(m.fonts).toEqual({ "open sans": "--font-family-body", "playfair display": "--font-family-heading" });
  });

  it("rewrites matching literals to var(--token, original) — keeping the original as the fallback — and leaves scripts alone", () => {
    const m = computeBrandMapping(WP_HTML);
    const out = applyBrandMappingToHtml(WP_HTML, m);
    expect(out).toContain("background-color:var(--color-brand-primary-500, #1a73e8)");
    expect(out).toContain("border:2px solid var(--color-brand-primary-500, #1A73E8)");
    expect(out).toContain("--theme-accent:var(--color-brand-primary-500, #1A73E8)");
    expect(out).toContain("font-family:var(--font-family-body, 'Open Sans',Arial,sans-serif)");
    expect(out).toContain(`font-family:var(--font-family-heading, "Playfair Display",serif)`);
    expect(out).toContain("background:var(--color-brand-secondary-500, rgb(233, 30, 99))");
    expect(out).toContain('style="background-color:var(--color-brand-primary-500, #1a73e8);color:#fff"');
    expect(out).toContain(`<script>var c="#1a73e8";</script>`);
    // The page's background white is only swapped where it's a background: white button text stays white.
    expect(out).toContain("background-color:var(--color-bg-canvas, #ffffff)");
    expect(out).toContain("color:#fff;");
    expect(out).toContain("body{color:var(--color-text-primary, #222222)");
  });

  it("works on a linked stylesheet too, and returns unreadable CSS untouched", () => {
    const m = { colors: { [normalizeColor("#F00")]: "--color-brand-primary-500" }, fonts: {} };
    expect(applyBrandMappingToCss(".a{color:#F00;outline:1px solid #ff0000}", m)).toBe(".a{color:var(--color-brand-primary-500, #F00);outline:1px solid var(--color-brand-primary-500, #ff0000)}");
    expect(applyBrandMappingToCss(".a{color:#F00", m)).toBe(".a{color:#F00"); // unreadable: served exactly as stored
    expect(applyBrandMappingToCss("}}}{{{", m)).toBe("}}}{{{");
  });
});

// ------------------------------------------------------------------------------------------------ serving
describe("serving the brand on every kind of page", () => {
  const page = "<html><head><title>x</title><style>p{color:#1a73e8}</style></head><body><p>hi</p></body></html>";

  it("links the sheet at the end of <head> with the revision, once", () => {
    const out = insertBrandLink(page, brandLinkTag("s1", "abc"));
    expect(out).toContain('<link rel="stylesheet" href="/__plexo/brand/s1.css?v=abc" data-plexo-brand></head>');
    expect(insertBrandLink(out, brandLinkTag("s1", "def"))).toBe(out);
    expect(brandLinkTag("s1", "abc", { stable: true })).toContain('href="/__plexo/brand/s1.css"');
  });

  it("V2 pages and apps get the link; raw pages only with the mapping on (and then their colours too); classic pages nothing", async () => {
    seedBrand("s1", { revision: "rev1" });
    expect(await applySiteBrandToHtml(page, "s1", "v2")).toContain("/__plexo/brand/s1.css?v=rev1");
    expect(await applySiteBrandToHtml(page, "s1", "app")).toContain("?v=rev1");
    expect(await applySiteBrandToHtml(page, "s1", "classic")).toBe(page);
    expect(await applySiteBrandToHtml(page, "s1", "raw")).toBe(page);
    expect(await applySiteBrandToHtml(page, "s1", "deployed-static")).toContain('href="/__plexo/brand/s1.css"');
    state.mappings.set("s1", { siteId: "s1", colors: { "#1a73e8": "--color-brand-primary-500" }, fonts: {}, enabled: true, computedAt: "x" });
    forgetServingMemo();
    const raw = await applySiteBrandToHtml(page, "s1", "raw");
    expect(raw).toContain("color:var(--color-brand-primary-500, #1a73e8)");
    expect(raw).toContain("data-plexo-brand");
    // "Use my brand on this site" off: the original page, exactly.
    state.mappings.get("s1")!.enabled = false;
    forgetServingMemo();
    expect(await applySiteBrandToHtml(page, "s1", "raw")).toBe(page);
  });

  it("a site with no brand is served exactly as it was", async () => {
    expect(await applySiteBrandToHtml(page, "nobrand", "v2")).toBe(page);
  });
});

// ------------------------------------------------------------------------------------------------ server apps: opt-in only
describe("the brand link in a server app's pages is opt-in", () => {
  it("a site linked before the flag existed serves with the flag off, and only the owner's switch turns it on", async () => {
    seedSite("a1", { sourceType: "REACT_PROJECT" });
    state.deployed.set("a1", { templateId: "a1", type: "SSR" });
    seedBrand("a1", { revision: "r9" }); // an existing row: no injectServerApp
    expect((await brandForServing("a1"))?.serverInject).toBe(false);
    expect((await getSiteBrandState("a1")).brandInApp).toBe(false);
    await setSiteBrandOptions({ siteId: "a1", brandInApp: true });
    expect((await brandForServing("a1"))?.serverInject).toBe(true);
    expect((await getSiteBrandState("a1")).brandInApp).toBe(true);
    await setSiteBrandOptions({ siteId: "a1", brandInApp: false });
    expect((await brandForServing("a1"))?.serverInject).toBe(false);
  });
  it("the switch is refused for a site that isn't a server app, and changes nothing", async () => {
    seedSite("b1");
    seedBrand("b1");
    await expect(setSiteBrandOptions({ siteId: "b1", brandInApp: true })).rejects.toThrow(/own code/);
    expect(state.brands.get("b1")!.injectServerApp).toBeUndefined();
  });
  it("linking a server app from now on turns it on; linking an ordinary site never does", async () => {
    seedSite("a2");
    state.deployed.set("a2", { templateId: "a2", type: "SSR" });
    seedSite("s2");
    for (const id of ["a2", "s2"]) await linkSiteBrand({ siteId: id, userId: "u1", organizationId: "org1", projectId: "p1" });
    expect(state.brands.get("a2")!.injectServerApp).toBe(true);
    expect(state.brands.get("s2")!.injectServerApp).toBe(false);
  });
});
