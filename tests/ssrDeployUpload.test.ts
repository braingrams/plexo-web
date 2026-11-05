import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "org-1", subscriptionPlan: "ULTRA" }) }));
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: { organizationId: "org-1" } }) }) } }));
vi.mock("@/lib/subscription", () => ({ getTierFeatures: () => ({ ssrEnabled: true, ssrMonthlyBudgetUsd: 6 }) }));
vi.mock("@/lib/projects/ssrBudget", () => ({ reserveSsrBuild: async () => ({ ok: true }), releaseSsrBuild: async () => {} }));
vi.mock("@/lib/appFunctions/ssrVariableStore", () => ({ listSsrVariables: async () => [] }));
vi.mock("@/lib/appFunctions/ssrNames", () => ({ ssrFunctionName: () => "plexo-ssr-t1-preview" }));
vi.mock("@/lib/db/appEntities", () => ({ DeployedApp: { get: () => ({ go: async () => ({ data: null }) }), create: () => ({ go: async () => ({}) }) } }));
vi.mock("@/lib/projects/ssrRebuild", () => ({ markBuildQueued: async () => {} }));
const startSsrBuild = vi.fn(async (_input: any) => ({ id: "b1", status: "QUEUED" }));
vi.mock("@/lib/projects/builds", () => ({ startSsrBuild: (input: any) => startSsrBuild(input), BuildUnavailableError: class extends Error {} }));

let stored: Buffer | null = null;
const getObject = vi.fn(async (_key: string) => (stored ? { body: stored } : null));
const deleteObject = vi.fn(async (_key: string) => {});
vi.mock("@/lib/projects/blobStore", () => ({
  projectPrefix: (t: string) => `private/projects/${t}`,
  getObject: (key: string) => getObject(key),
  deleteObject: (key: string) => deleteObject(key),
}));

import { POST } from "@/app/api/v1/templates/[id]/ssr-deploy/route";

const UUID = "3f2b1c4e-8a9d-4b7e-9c1a-2d3e4f5a6b7c";
const OWN_KEY = `private/projects/t1/ssr/uploads/${UUID}.zip`;

async function astroZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("package.json", JSON.stringify({ name: "site", dependencies: { astro: "5.0.0" } }));
  return zip.generateAsync({ type: "nodebuffer" });
}

const jsonDeploy = (uploadKey: string) =>
  POST(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadKey }) }), { params: Promise.resolve({ id: "t1" }) });

describe("POST ssr-deploy from a direct upload", () => {
  beforeEach(() => {
    stored = null;
    startSsrBuild.mockClear();
    getObject.mockClear();
    deleteObject.mockClear();
  });

  it("queues the build from the staged zip and deletes the staged copy", async () => {
    stored = await astroZip();
    const res = await jsonDeploy(OWN_KEY);
    expect(res.status).toBe(202);
    expect(startSsrBuild.mock.calls[0][0]).toMatchObject({ templateId: "t1", framework: "astro" });
    expect(startSsrBuild.mock.calls[0][0].sourceZip).toBeInstanceOf(Uint8Array);
    expect(deleteObject).toHaveBeenCalledWith(OWN_KEY);
  });

  it("refuses a key from another app, and never reads it", async () => {
    stored = await astroZip();
    const res = await jsonDeploy(`private/projects/t2/ssr/uploads/${UUID}.zip`);
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
    expect(startSsrBuild).not.toHaveBeenCalled();
  });

  it("says the upload didn't arrive when nothing is staged", async () => {
    const res = await jsonDeploy(OWN_KEY);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/didn't reach storage/) });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("still accepts a small zip sent as multipart", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(await astroZip())], "site.zip", { type: "application/zip" }));
    const res = await POST(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-deploy", { method: "POST", body: fd }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(202);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
