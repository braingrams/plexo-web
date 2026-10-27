import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Production end-to-end check: after an app's FIRST publish, its live server function answered
// "This app doesn't exist or isn't published" — the functions were deployed before the live
// address existed, so they were given a made-up one. The address now comes first.

const order = vi.hoisted(() => [] as string[]);
const domains = vi.hoisted(() => ({ rows: [] as Array<{ domain: string }> }));

vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: () => ({ go: async () => ({ data: { id: "app", name: "Telly", sourceType: "REACT_PROJECT", organizationId: "org", userId: "u" } }) }),
    patch: () => ({ set: (v: any) => ({ go: async () => void order.push(`go live (${v.liveBuildId})`) }) }),
  },
  PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: domains.rows }) }) } },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { subscriptionPlan: "FREE" } }) }) } }));
vi.mock("@/lib/db/projectEntities", () => ({
  ProjectBuild: { patch: () => ({ set: () => ({ where: () => ({ go: async () => ({}) }), go: async () => ({}) }) }) },
}));
vi.mock("@/lib/projects/fileStore", () => ({ getVersionManifest: async () => ({ files: [] }), listFiles: vi.fn(), snapshotVersion: vi.fn(), diffManifests: vi.fn() }));
vi.mock("@/lib/projects/blobStore", () => ({ getBlob: vi.fn() }));
vi.mock("@/lib/appData/migrations", () => ({ applyMigrations: vi.fn(), migrationFilesFrom: () => [] }));
vi.mock("@/lib/appFunctions/deploy", () => ({
  deployFunctions: vi.fn(async () => {
    order.push(`deploy functions (address known: ${domains.rows.map((d) => d.domain).join(",") || "none"})`);
    return { deployed: ["ping"], removed: [], failed: [] };
  }),
}));
vi.mock("@/lib/sites/linkDomain", () => ({
  linkDomainToTemplate: vi.fn(async (_o: unknown, _t: string, domain: string) => {
    order.push(`register ${domain}`);
    domains.rows.push({ domain: `${domain}.plexopages.com` });
    return { finalDomain: `${domain}.plexopages.com` };
  }),
}));
vi.mock("@/lib/plan/siteLimits", () => ({ isDomainLive: () => true }));
vi.mock("@/lib/plan/entitlement", () => ({ effectivePlan: () => "FREE" }));
vi.mock("@/lib/appRuntime/context", () => ({ forgetAppContext: vi.fn() }));
vi.mock("@/lib/appRuntime/data", () => ({ forgetSchemaVersion: vi.fn() }));

import { finalizeBuild } from "@/lib/projects/pipeline";

beforeEach(() => {
  order.length = 0;
  domains.rows = [];
});

describe("an app's first publish", () => {
  it("registers the live address before deploying functions, then goes live", async () => {
    const out = await finalizeBuild({ id: "b1", templateId: "app", versionId: "v1", status: "SUCCEEDED", postStatus: "PENDING", mode: "release", publishSubdomain: "telly", functionBundles: { ping: {} } } as never);
    expect(order).toEqual(["register telly", "deploy functions (address known: telly.plexopages.com)", "go live (b1)"]);
    expect((out as any).publishResult).toMatchObject({ liveUrl: "https://telly.plexopages.com", switched: true });
  });

  it("a preview build doesn't register a live address", async () => {
    await finalizeBuild({ id: "b2", templateId: "app", versionId: "v1", status: "SUCCEEDED", postStatus: "PENDING", mode: "preview", functionBundles: { ping: {} } } as never).catch(() => undefined);
    expect(order.some((s) => s.startsWith("register"))).toBe(false);
  });
});
