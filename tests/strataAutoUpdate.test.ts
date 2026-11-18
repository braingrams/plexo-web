import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDefaultDesignSystem, type DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { baseOf } from "@charisol/plexo-sdk/v2/strata";

// "Keep my website up to date with Strata": turning it on/off (key custody) and the job that
// applies Strata's changes on its own.

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  system: null as any,
  applied: [] as Array<{ system: any; opts: any }>,
  skipped: [] as string[],
  liveBuildId: undefined as string | undefined,
  headVersion: "v1",
  liveVersion: "v1",
  builds: [] as string[],
  buildFails: false,
  userToken: "user-session-token" as string | null,
  userId: "u1",
}));

vi.mock("@/lib/db/coreEntities", () => {
  const conflict = () => Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
  return {
    User: { get: () => ({ go: async () => ({ data: { name: "Ada" } }) }) },
    // No site-level brand links here: the cron route's site sweep finds nothing, and apps aren't managed by one.
    SiteBrand: { get: () => ({ go: async () => ({ data: null }) }), scan: { where: () => ({ go: async () => ({ data: [], cursor: null }) }) } },
    StrataProjectWebhook: { get: () => ({ go: async () => ({ data: null }) }) },
    StrataAutoUpdate: {
      get: ({ appId }: { appId: string }) => ({ go: async () => ({ data: state.rows.get(appId) ?? null }) }),
      upsert: (item: Row) => ({ go: async () => void state.rows.set(item.appId, { ...state.rows.get(item.appId), ...item }) }),
      delete: ({ appId }: { appId: string }) => ({ go: async () => void state.rows.delete(appId) }),
      scan: { where: () => ({ go: async () => ({ data: [...state.rows.values()].filter((r) => r.status === "active"), cursor: null }) }) },
      patch: ({ appId }: { appId: string }) => {
        let set: Row = {};
        let remove: string[] = [];
        const b: any = {
          set: (v: Row) => ((set = v), b),
          remove: (v: string[]) => ((remove = v), b),
          where: () => b,
          go: async () => {
            const row = state.rows.get(appId);
            if (!row) throw new Error("missing");
            // The lock: a fresh runningAt blocks a second claim.
            if ("runningAt" in set && row.runningAt && Date.now() - new Date(row.runningAt).getTime() < 600_000) throw conflict();
            const next = { ...row, ...set };
            for (const k of remove) delete next[k];
            state.rows.set(appId, next);
          },
        };
        return b;
      },
    },
  };
});
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: { id: "app1", name: "Café", organizationId: "org1", liveBuildId: state.liveBuildId } }) }) } }));
vi.mock("@/lib/db/projectEntities", () => ({ ProjectBuild: { get: () => ({ go: async () => ({ data: { versionId: state.liveVersion } }) }) } }));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => state.userToken }));
vi.mock("@/lib/projects/designs", () => ({
  listDesigns: async () => ({ designs: [], designSystem: state.system }),
  applyDesignSystem: async (_id: string, system: any, _by: string, opts: any) => {
    state.applied.push({ system, opts });
    state.system = system;
    return { recompiled: opts?.recompile === false ? [] : ["Home", "Pricing"], skipped: opts?.recompile === false ? [] : state.skipped };
  },
}));
vi.mock("@/lib/projects/pipeline", () => ({
  ensureVersion: async () => ({ versionId: state.headVersion, changed: false, diff: null }),
  startPreview: async () => {
    if (state.buildFails) throw new Error("no queue");
    state.builds.push("preview");
    return { id: "b1" };
  },
  startPublish: async () => {
    state.builds.push("publish");
    return { id: "b2" };
  },
}));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: state.userId, organizationId: "org1", role: null }) }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/lib/projects/appAccess", () => ({
  loadApp: async () => ({ resolved: { userId: state.userId }, app: { id: "app1", name: "Café" }, actor: {} }),
  appError: () => new Response(JSON.stringify({ error: "x" }), { status: 500 }),
}));

import { enableAutoUpdate, disableAutoUpdate, getAutoUpdateState, runStrataAutoUpdate, runAllStrataAutoUpdates, NEEDS_REVIEW_NOTE, RECONNECT_NOTE } from "@/lib/strata/autoUpdate";
import { POST as enableRoute, GET as getRoute, DELETE as disableRoute } from "@/app/api/v1/apps/[id]/strata-auto-update/route";
import { GET as cronRoute } from "@/app/api/internal/strata-auto-update/route";
import { decryptStrataToken, encryptStrataToken } from "@/lib/crypto";

const KEY = "strata_ik_0123456789abcdef_" + "A".repeat(43);
const ctx = { params: Promise.resolve({ id: "app1" }) };
let remoteRevision = "r1";
let remoteStatus = 200;
let remoteTokens: any[] = [];
const calls: Array<{ method: string; url: string; auth: string | null }> = [];

const strataToken = (t: any) => ({ key: t.key, name: t.name, value: t.value, type: t.type, unit: t.unit, layer: t.layer, comment: t.comment });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function linked(overrides: Record<string, unknown> = {}): DesignSystem {
  const ds = createDefaultDesignSystem();
  return { ...ds, strata: { projectId: "p1", autoUpdate: true, base: baseOf(ds), ...overrides } };
}
const changedRemote = (ds: DesignSystem) => ds.tokens.map((t, i) => strataToken(i === 0 ? { ...t, value: "#abcdef" } : t));

function seedRow(extra: Row = {}) {
  state.rows.set("app1", { appId: "app1", userId: "u1", strataProjectId: "p1", keyId: "k1", ciphertext: encryptStrataToken(KEY), status: "active", createdAt: "2026-01-01T00:00:00.000Z", ...extra });
}

beforeEach(() => {
  process.env.STRATA_API_URL = "https://strata.test/v1";
  process.env.STRATA_TOKEN_ENCRYPTION_SECRET = "test-secret-for-strata-tokens";
  process.env.CRON_SECRET = "cron-secret";
  Object.assign(state, { system: linked(), applied: [], skipped: [], liveBuildId: undefined, headVersion: "v1", liveVersion: "v1", builds: [], buildFails: false, userToken: "user-session-token", userId: "u1" });
  state.rows.clear();
  calls.length = 0;
  remoteRevision = "r1";
  remoteStatus = 200;
  remoteTokens = linked().tokens.map(strataToken);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string>)?.Authorization ?? null;
    calls.push({ method, url, auth });
    if (url.endsWith("/integration-keys") && method === "POST") return json(201, { data: { keyId: "k1", key: KEY, scope: "design-system:read" } });
    if (url.includes("/integration-keys/") && method === "DELETE") return json(200, { data: {} });
    if (remoteStatus !== 200 && auth === `Bearer ${KEY}`) return json(remoteStatus, { error: {} });
    if (url.endsWith("/design-system/revision")) return json(200, { data: { projectId: "p1", revision: remoteRevision } });
    if (url.endsWith("/design-system")) return json(200, { data: { revision: remoteRevision, variables: remoteTokens, components: linked().components } });
    return json(404, {});
  });
});

describe("turning it on and off", () => {
  it("creates a project-scoped key, stores only its ciphertext and never returns it", async () => {
    const res = await enableRoute(new NextRequest("https://plexo.test/api/v1/apps/app1/strata-auto-update", { method: "POST" }), ctx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("ciphertext");
    expect(JSON.parse(text)).toMatchObject({ enabled: true, status: "active" });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.url).toBe("https://strata.test/v1/projects/p1/integration-keys");
    expect(create.auth).toBe("Bearer user-session-token");
    const row = state.rows.get("app1")!;
    expect(row.ciphertext).not.toContain(KEY);
    expect(decryptStrataToken(row.ciphertext)).toBe(KEY);
    expect(row).toMatchObject({ keyId: "k1", strataProjectId: "p1", userId: "u1" });
    expect(state.applied.at(-1)?.system.strata.autoUpdate).toBe(true);
    expect(state.applied.at(-1)?.opts).toEqual({ recompile: false });
  });

  it("needs the site linked to a Strata project and a Strata connection", async () => {
    state.system = { ...createDefaultDesignSystem() };
    await expect(enableAutoUpdate({ appId: "app1", appName: "Café", userId: "u1" })).rejects.toThrow(/Link this site/);
    state.system = linked();
    state.userToken = null;
    await expect(enableAutoUpdate({ appId: "app1", appName: "Café", userId: "u1" })).rejects.toThrow(/Connect Strata/);
    expect(state.rows.size).toBe(0);
  });

  it("turning it off revokes the key in Strata, deletes the record and clears the setting", async () => {
    seedRow();
    const res = await disableRoute(new NextRequest("https://plexo.test/x", { method: "DELETE" }), ctx);
    expect(await res.json()).toMatchObject({ enabled: false, status: "off" });
    expect(calls.some((c) => c.method === "DELETE" && c.url === "https://strata.test/v1/projects/p1/integration-keys/k1")).toBe(true);
    expect(state.rows.has("app1")).toBe(false);
    expect(state.system.strata.autoUpdate).toBe(false);
  });

  it("still turns off when Strata can't be reached to revoke", async () => {
    seedRow();
    state.userToken = null;
    await disableAutoUpdate({ appId: "app1", userId: "u1" });
    expect(state.rows.has("app1")).toBe(false);
  });

  it("GET reports the plain-language state without any secret", async () => {
    seedRow({ lastCheckedAt: "2026-01-02T00:00:00.000Z", lastResultKind: "updated", lastResult: "Done." });
    const text = await (await getRoute(new NextRequest("https://plexo.test/x"), ctx)).text();
    expect(JSON.parse(text)).toMatchObject({ enabled: true, status: "active", lastResult: "Done.", lastCheckedAt: "2026-01-02T00:00:00.000Z" });
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain(KEY);
  });
});

describe("runStrataAutoUpdate", () => {
  it("does nothing for apps that haven't turned it on", async () => {
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("skipped");
  });

  it("stops cheaply when Strata's revision hasn't changed", async () => {
    seedRow({ lastRevision: "r1", lastResultKind: "up-to-date" });
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("unchanged");
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
    expect(state.applied).toHaveLength(0);
    expect(state.rows.get("app1")!.lastCheckedAt).toBeDefined();
    expect(state.rows.get("app1")!.runningAt).toBeUndefined();
  });

  it("applies a safe change: saves the merged system, recompiles, rebuilds the preview", async () => {
    seedRow();
    remoteRevision = "r2";
    remoteTokens = changedRemote(state.system);
    const result = await runStrataAutoUpdate("app1");
    expect(result.outcome).toBe("updated");
    expect(state.applied).toHaveLength(1);
    expect(state.applied[0].system.tokens[0].value).toBe("#abcdef");
    expect(state.applied[0].system.strata).toMatchObject({ projectId: "p1", autoUpdate: true });
    expect(state.builds).toEqual(["preview"]);
    expect(result.message).toContain("2 pages");
    const row = state.rows.get("app1")!;
    expect(row).toMatchObject({ lastResultKind: "updated", lastRevision: "r2" });
    // Running again is a no-op.
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("unchanged");
    expect(state.applied).toHaveLength(1);
    expect(state.builds).toEqual(["preview"]);
  });

  it("republishes a live site when nothing else is waiting to be published", async () => {
    seedRow();
    state.liveBuildId = "live1";
    remoteRevision = "r2";
    remoteTokens = changedRemote(state.system);
    await runStrataAutoUpdate("app1");
    expect(state.builds).toEqual(["preview", "publish"]);
  });

  it("does not publish the owner's unfinished work: preview only, and says so", async () => {
    seedRow();
    state.liveBuildId = "live1";
    state.liveVersion = "older";
    remoteRevision = "r2";
    remoteTokens = changedRemote(state.system);
    const result = await runStrataAutoUpdate("app1");
    expect(state.builds).toEqual(["preview"]);
    expect(result.message).toMatch(/Publish when you're ready/);
  });

  it("reports pages edited in code as skipped", async () => {
    seedRow();
    state.skipped = ["About us"];
    remoteRevision = "r2";
    remoteTokens = changedRemote(state.system);
    const result = await runStrataAutoUpdate("app1");
    expect(result.message).toContain("About us was edited in code");
  });

  it("says so when the rebuild couldn't start", async () => {
    seedRow();
    state.buildFails = true;
    remoteRevision = "r2";
    remoteTokens = changedRemote(state.system);
    const result = await runStrataAutoUpdate("app1");
    expect(result.outcome).toBe("updated");
    expect(result.message).toMatch(/press Build/);
  });

  it("changes nothing and leaves a note when the change needs a review", async () => {
    seedRow();
    // Changed in Plexo and not sent yet, and changed in Strata: not safe.
    state.system = { ...state.system, tokens: state.system.tokens.map((t: any, i: number) => (i === 0 ? { ...t, value: "#111111" } : t)) };
    remoteRevision = "r2";
    remoteTokens = changedRemote(linked());
    const result = await runStrataAutoUpdate("app1");
    expect(result).toEqual({ outcome: "needs-review", message: NEEDS_REVIEW_NOTE });
    expect(state.applied).toHaveLength(0);
    expect(state.builds).toEqual([]);
    expect((await getAutoUpdateState("app1")).lastResult).toBe(NEEDS_REVIEW_NOTE);
    // The note is re-checked next time (the owner may have resolved it).
    await runStrataAutoUpdate("app1");
    expect(calls.filter((c) => c.url.endsWith("/design-system") && c.method === "GET").length).toBe(2);
  });

  it("marks it needs-reconnect when Strata rejects the key", async () => {
    seedRow();
    remoteStatus = 401;
    const result = await runStrataAutoUpdate("app1");
    expect(result).toEqual({ outcome: "needs-reconnect", message: RECONNECT_NOTE });
    expect(await getAutoUpdateState("app1")).toMatchObject({ status: "needs-reconnect", lastResult: RECONNECT_NOTE });
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("skipped");
  });

  it("stops and cleans up when the owner switched it off or linked another project", async () => {
    seedRow();
    state.system = linked({ autoUpdate: false });
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("stopped");
    expect(state.rows.has("app1")).toBe(false);
    seedRow();
    state.system = linked({ projectId: "other" });
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("stopped");
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("never throws, and records a retry note on a Strata outage", async () => {
    seedRow();
    remoteStatus = 503;
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("error");
    expect(state.rows.get("app1")!.status).toBe("active");
  });

  it("a second run while one is in progress backs off", async () => {
    seedRow({ runningAt: new Date().toISOString() });
    expect((await runStrataAutoUpdate("app1")).outcome).toBe("busy");
    expect(calls).toHaveLength(0);
    expect(state.rows.get("app1")!.runningAt).toBeDefined();
  });

  it("two simultaneous runs only apply once", async () => {
    seedRow();
    remoteRevision = "r2";
    remoteTokens = changedRemote(state.system);
    const results = await Promise.all([runStrataAutoUpdate("app1"), runStrataAutoUpdate("app1")]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["busy", "updated"]);
    expect(state.applied).toHaveLength(1);
  });

  it("the sweep runs every active app", async () => {
    seedRow({ lastRevision: "r1", lastResultKind: "up-to-date" });
    const summary = await runAllStrataAutoUpdates();
    expect(summary).toMatchObject({ checked: 1, deferred: 0, counts: { unchanged: 1 } });
  });
});

describe("the scheduled route", () => {
  const call = (headers: Record<string, string> = {}) => cronRoute(new NextRequest("https://plexo.test/api/internal/strata-auto-update", { headers }));
  it("rejects a missing or wrong secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ "x-cron-secret": "nope" })).status).toBe(401);
    expect((await call({ "x-cron-secret": "cron-secre" })).status).toBe(401);
  });
  it("runs the sweep with the right secret", async () => {
    const res = await call({ "x-cron-secret": "cron-secret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checked: 0 });
  });
});
