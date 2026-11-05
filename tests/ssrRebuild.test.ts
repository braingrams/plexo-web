import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import { NextRequest } from "next/server";

const startSsrBuild = vi.fn(async (_input: any) => ({ id: "b-rebuild", status: "QUEUED" }));
const markBuildQueued = vi.fn(async (..._args: any[]) => {});
const releaseSsrBuild = vi.fn(async (_args: any) => {});
let stored: Buffer | null = null;

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "org-1", subscriptionPlan: "ULTRA" }) }));
vi.mock("@/lib/appFunctions/ssrGuard", () => ({ guardSsrSettings: async () => ({ ok: true }) }));
vi.mock("@/lib/appFunctions/ssrVariableStore", () => ({ listSsrVariables: async () => [] }));
vi.mock("@/lib/subscription", () => ({ getTierFeatures: () => ({ ssrMonthlyBudgetUsd: 6 }) }));
vi.mock("@/lib/projects/blobStore", () => ({ getObject: async () => (stored ? { body: stored } : null) }));
vi.mock("@/lib/projects/builds", () => ({
  startSsrBuild: (input: any) => startSsrBuild(input),
  ssrLatestSourceKey: (templateId: string) => `private/projects/${templateId}/ssr/latest.zip`,
  BuildUnavailableError: class extends Error {},
}));
vi.mock("@/lib/projects/ssrBudget", () => ({ reserveSsrBuild: async () => ({ ok: true }), releaseSsrBuild: (args: any) => releaseSsrBuild(args) }));
vi.mock("@/lib/projects/ssrRebuild", () => ({ markBuildQueued: (...args: any[]) => markBuildQueued(...args) }));

import { POST } from "@/app/api/v1/templates/[id]/ssr-rebuild/route";

async function astroZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("package.json", JSON.stringify({ name: "site", dependencies: { astro: "5.0.0" } }));
  return zip.generateAsync({ type: "nodebuffer" });
}

const rebuild = () =>
  POST(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-rebuild", { method: "POST" }), { params: Promise.resolve({ id: "t1" }) });

describe("POST ssr-rebuild", () => {
  beforeEach(() => {
    startSsrBuild.mockClear();
    markBuildQueued.mockClear();
    releaseSsrBuild.mockClear();
    stored = null;
  });

  it("refuses when no source has been uploaded, and queues nothing", async () => {
    const res = await rebuild();
    expect(res.status).toBe(409);
    expect(startSsrBuild).not.toHaveBeenCalled();
  });

  it("queues a build from the stored source without sending the zip again", async () => {
    stored = await astroZip();
    const res = await rebuild();
    expect(res.status).toBe(202);
    const input = startSsrBuild.mock.calls[0][0] as any;
    expect(input).toMatchObject({ templateId: "t1", framework: "astro", root: "" });
    expect(input.sourceZip).toBeUndefined();
    expect(markBuildQueued).toHaveBeenCalledWith("t1", expect.any(String));
    expect(await res.json()).toMatchObject({ buildId: "b-rebuild", framework: "astro" });
    expect(releaseSsrBuild).not.toHaveBeenCalled();
  });
});
