import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Server apps (SSR) connected to a GitHub branch: a push builds the pushed commit, a good build goes live
// (publish-on-push), an older build never replaces a newer one, and every outcome is written to the link.

const db = vi.hoisted(() => ({
  link: null as null | Record<string, any>,
  app: { publishError: "" } as Record<string, any>,
  patches: [] as Array<Record<string, any>>,
  recent: [] as Array<Record<string, any>>,
  builds: {} as Record<string, Record<string, any>>,
}));
const plan = vi.hoisted(() => ({ ssrEnabled: true }));
const mocks = vi.hoisted(() => ({
  deploySsrApp: vi.fn(async () => ({ deployed: ["fn"], removed: [], failed: [] })),
  publishSsrPreview: vi.fn(),
  runSsrControl: vi.fn(async () => {}),
  downloadRepoZip: vi.fn(async () => new Uint8Array([1, 2, 3])),
  queueSsrBuildFromZip: vi.fn(),
  deleteObject: vi.fn(async () => {}),
}));

const chain = (result: unknown) => ({ go: async () => result, where: () => ({ go: async () => result }) });

vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: () => ({ go: async () => ({ data: { id: "t", name: "Telly", organizationId: "org", userId: "u", sourceType: "REACT_PROJECT" } }) }),
    patch: () => ({ set: () => ({ go: async () => ({}) }) }),
  },
  PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
}));
vi.mock("@/lib/db/coreEntities", () => ({
  User: { get: () => ({ go: async () => ({ data: { id: "u", subscriptionPlan: "ULTRA" } }) }) },
}));
vi.mock("@/lib/db/projectEntities", () => ({
  ProjectBuild: { patch: () => ({ set: () => chain({}) }) },
  ProjectGitLink: {
    get: () => ({ go: async () => ({ data: db.link }) }),
    patch: () => ({
      set: (v: Record<string, any>) => ({
        go: async () => {
          db.patches.push(v);
          if (db.link) Object.assign(db.link, v);
          return {};
        },
      }),
    }),
    put: () => ({ go: async () => ({}) }),
    delete: () => ({ go: async () => ({}) }),
  },
}));
vi.mock("@/lib/db/appEntities", () => ({
  DeployedApp: {
    get: () => ({ go: async () => ({ data: db.app }) }),
    patch: () => ({ set: () => ({ go: async () => ({}) }) }),
  },
}));
vi.mock("@/lib/projects/builds", () => ({
  recentBuilds: async () => db.recent,
  getBuild: async (id: string) => db.builds[id] ?? null,
  ssrBuildSourceKey: (templateId: string, buildId: string) => `key/${templateId}/${buildId}`,
  recordLatestBuild: async () => {},
  startBuild: vi.fn(),
  startSsrBuild: vi.fn(),
  waitForBuild: vi.fn(),
  isFinished: () => true,
  BuildUnavailableError: class extends Error {},
}));
vi.mock("@/lib/projects/blobStore", () => ({ getBlob: vi.fn(), deleteObject: mocks.deleteObject }));
vi.mock("@/lib/projects/fileStore", () => ({ getVersionManifest: async () => ({ files: [] }), listFiles: vi.fn(), snapshotVersion: vi.fn(), diffManifests: vi.fn() }));
vi.mock("@/lib/projects/github/archive", () => ({ downloadRepoZip: mocks.downloadRepoZip }));
vi.mock("@/lib/projects/ssrBuildQueue", () => ({ queueSsrBuildFromZip: mocks.queueSsrBuildFromZip }));
vi.mock("@/lib/appFunctions/deploy", () => ({
  deploySsrApp: mocks.deploySsrApp,
  publishSsrPreview: mocks.publishSsrPreview,
  deployFunctions: vi.fn(),
}));
vi.mock("@/lib/appFunctions/ssrControlRun", () => ({ runSsrControl: mocks.runSsrControl }));
vi.mock("@/lib/subscription", () => ({ getTierFeatures: () => ({ ssrEnabled: plan.ssrEnabled, ssrMonthlyBudgetUsd: 6 }) }));
vi.mock("@/lib/plan/entitlement", () => ({ effectivePlan: () => "ULTRA" }));
vi.mock("@/lib/appRuntime/context", () => ({ forgetAppContext: vi.fn() }));
vi.mock("@/lib/appRuntime/data", () => ({ forgetSchemaVersion: vi.fn() }));

import { finalizeBuild } from "@/lib/projects/pipeline";
import { queueSsrPushBuild, reportGitBuildFailed } from "@/lib/projects/github/ssrPush";

const link = (over: Record<string, unknown> = {}) => ({
  templateId: "t",
  organizationId: "org",
  installationId: 9,
  repoFullName: "acme/site",
  repoId: 1,
  branch: "main",
  linkedBy: "u",
  status: "OK",
  lastSyncedCommitSha: "bbb2222",
  publishOnPush: true,
  ...over,
});

const ssrBuild = (over: Record<string, unknown> = {}) => ({
  id: "cur",
  templateId: "t",
  versionId: "ssr-cur",
  status: "SUCCEEDED",
  postStatus: "PENDING",
  mode: "preview",
  kind: "ssr",
  outputPrefix: "sites/t/cur",
  createdAt: "2026-11-12T10:00:00.000Z",
  sourceCommitSha: "bbb2222",
  functionBundles: { server: { key: "bundle/server.zip" } },
  ...over,
});

const lastStatus = () => db.patches.filter((p) => "statusMessage" in p).at(-1);

beforeEach(() => {
  db.link = link();
  db.app = { publishError: "", functionUrl: "https://live.example" };
  db.patches.length = 0;
  db.recent = [];
  db.builds = {};
  plan.ssrEnabled = true;
  vi.clearAllMocks();
  mocks.deploySsrApp.mockResolvedValue({ deployed: ["fn"], removed: [], failed: [] });
});

describe("a push to a server app's linked branch", () => {
  it("builds the pushed commit and publishes it when publish-on-push is on", async () => {
    mocks.queueSsrBuildFromZip.mockResolvedValue({ ok: true, buildId: "cur", status: "QUEUED", framework: "nextjs", functionName: "f", warnings: [] });
    await queueSsrPushBuild(db.link as never, { after: "bbb2222" });
    expect(mocks.downloadRepoZip).toHaveBeenCalledWith(9, "acme/site", "bbb2222");
    expect(mocks.queueSsrBuildFromZip).toHaveBeenCalledWith(expect.objectContaining({ templateId: "t", sourceCommitSha: "bbb2222", budgetUsd: 6 }));
    expect(lastStatus()?.statusMessage).toBe("Building commit bbb2222 from GitHub.");
  });

  it("writes a rejected budget reservation to the link instead of dropping it", async () => {
    mocks.queueSsrBuildFromZip.mockResolvedValue({ ok: false, status: 429, error: "This month's server build budget is used up ($6.00 of $6.00 projected). It resets on the first of next month." });
    await queueSsrPushBuild(db.link as never, { after: "ccc3333" });
    expect(lastStatus()).toMatchObject({ status: "ERROR" });
    expect(lastStatus()?.statusMessage).toContain("Commit ccc3333 wasn't built.");
    expect(lastStatus()?.statusMessage).toContain("budget is used up");
  });

  it("records a plan that doesn't include server apps as an error, and builds nothing", async () => {
    plan.ssrEnabled = false;
    await queueSsrPushBuild(db.link as never, { after: "ddd4444" });
    expect(mocks.downloadRepoZip).not.toHaveBeenCalled();
    expect(mocks.queueSsrBuildFromZip).not.toHaveBeenCalled();
    expect(lastStatus()).toMatchObject({ status: "ERROR" });
    expect(lastStatus()?.statusMessage).toContain("Pro plan");
  });
});

describe("finishing a build for a GitHub commit", () => {
  it("publishes a current build once it has deployed (publish-on-push)", async () => {
    db.recent = [{ id: "cur", kind: "ssr", status: "SUCCEEDED", createdAt: "2026-11-12T10:00:00.000Z" }];
    mocks.publishSsrPreview.mockResolvedValue({ functionName: "f", functionUrl: "u", warnings: [] });
    await finalizeBuild(ssrBuild() as never);
    expect(mocks.deploySsrApp).toHaveBeenCalledWith(expect.objectContaining({ templateId: "t", target: "preview" }));
    expect(mocks.runSsrControl).toHaveBeenCalledWith({ kind: "publish", templateId: "t" });
    expect(lastStatus()).toMatchObject({ status: "OK", statusMessage: "Live from commit bbb2222." });
    expect(mocks.deleteObject).toHaveBeenCalledWith("key/t/cur");
  });

  it("leaves a build as a preview when publish-on-push is off", async () => {
    db.link = link({ publishOnPush: false });
    db.recent = [{ id: "cur", kind: "ssr", status: "SUCCEEDED", createdAt: "2026-11-12T10:00:00.000Z" }];
    await finalizeBuild(ssrBuild() as never);
    expect(mocks.runSsrControl).not.toHaveBeenCalled();
    expect(lastStatus()?.statusMessage).toBe("Preview built from commit bbb2222. Publish it to put it live.");
  });

  it("reports a deploy failure on the link and doesn't publish", async () => {
    db.recent = [{ id: "cur", kind: "ssr", status: "SUCCEEDED", createdAt: "2026-11-12T10:00:00.000Z" }];
    mocks.deploySsrApp.mockResolvedValue({ deployed: [], removed: [], failed: [{ name: "server", message: "function too large" }] } as any);
    await finalizeBuild(ssrBuild() as never);
    expect(mocks.runSsrControl).not.toHaveBeenCalled();
    expect(lastStatus()).toMatchObject({ status: "ERROR" });
    expect(lastStatus()?.statusMessage).toContain("function too large");
  });

  it("a build replaced by a newer queued build neither deploys nor publishes", async () => {
    db.recent = [
      { id: "newer", kind: "ssr", status: "QUEUED", createdAt: "2026-11-12T10:05:00.000Z" },
      { id: "cur", kind: "ssr", status: "BUILDING", createdAt: "2026-11-12T10:00:00.000Z" },
    ];
    await finalizeBuild(ssrBuild() as never);
    expect(mocks.deploySsrApp).not.toHaveBeenCalled();
    expect(mocks.runSsrControl).not.toHaveBeenCalled();
    // The link's current commit is the one that was built, so its status says it was replaced.
    expect(lastStatus()?.statusMessage).toContain("replaced by a newer build");
  });

  it("a newer build that failed doesn't stop an older commit from going out", async () => {
    db.recent = [{ id: "newer", kind: "ssr", status: "FAILED", createdAt: "2026-11-12T10:05:00.000Z" }];
    mocks.publishSsrPreview.mockResolvedValue({ functionName: "f", functionUrl: "u", warnings: [] });
    await finalizeBuild(ssrBuild() as never);
    expect(mocks.deploySsrApp).toHaveBeenCalled();
  });

  it("an older commit's build doesn't write the link once a newer push has moved it on", async () => {
    db.link = link({ lastSyncedCommitSha: "newer999" });
    db.recent = [];
    await finalizeBuild(ssrBuild() as never);
    expect(db.patches.filter((p) => "statusMessage" in p)).toHaveLength(0);
  });
});

describe("a failed GitHub build", () => {
  it("is reported on the link when it is the link's current commit", async () => {
    db.builds.f1 = { id: "f1", templateId: "t", kind: "ssr", status: "FAILED", sourceCommitSha: "bbb2222", summary: "2 errors in src/App.tsx", createdAt: "2026-11-12T10:00:00.000Z" };
    db.recent = [];
    await reportGitBuildFailed("f1");
    expect(lastStatus()).toMatchObject({ status: "ERROR" });
    expect(lastStatus()?.statusMessage).toContain("didn't build (2 errors in src/App.tsx)");
  });

  it("is not reported for a commit the link has moved past", async () => {
    db.link = link({ lastSyncedCommitSha: "newer999" });
    db.builds.f1 = { id: "f1", templateId: "t", kind: "ssr", status: "FAILED", sourceCommitSha: "bbb2222", summary: "x", createdAt: "2026-11-12T10:00:00.000Z" };
    await reportGitBuildFailed("f1");
    expect(db.patches.filter((p) => "statusMessage" in p)).toHaveLength(0);
  });
});
