import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const queued = vi.fn(async (_message: unknown) => {});
const patched = vi.fn(async (_fields: unknown) => {});
let app: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "org-1", subscriptionPlan: "ULTRA" }) }));
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: { organizationId: "org-1" } }) }) } }));
vi.mock("@/lib/db/appEntities", () => ({
  DeployedApp: {
    get: () => ({ go: async () => ({ data: app }) }),
    patch: (_key: unknown) => ({ set: (fields: unknown) => { patched(fields); return { go: async () => ({}) }; } }),
  },
}));
vi.mock("@/lib/appFunctions/ssrControl", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/appFunctions/ssrControl")>();
  return { ...real, queueSsrControl: (message: unknown) => queued(message) };
});

import { parseSsrControlMessage } from "@/lib/appFunctions/ssrControl";
import { POST, GET } from "@/app/api/v1/templates/[id]/ssr-publish/route";

describe("parseSsrControlMessage", () => {
  it("accepts a publish and a variables message", () => {
    expect(parseSsrControlMessage(JSON.stringify({ kind: "publish", templateId: "t1" }))).toEqual({ kind: "publish", templateId: "t1" });
    expect(parseSsrControlMessage(JSON.stringify({ kind: "variables", templateId: "t1", env: "live" }))).toEqual({ kind: "variables", templateId: "t1", env: "live" });
  });
  it("drops anything else", () => {
    expect(parseSsrControlMessage("not json")).toBeNull();
    expect(parseSsrControlMessage(JSON.stringify({ kind: "delete", templateId: "t1" }))).toBeNull();
    expect(parseSsrControlMessage(JSON.stringify({ kind: "publish", templateId: "../x" }))).toBeNull();
    expect(parseSsrControlMessage(JSON.stringify({ kind: "variables", templateId: "t1", env: "staging" }))).toBeNull();
  });
  it("refuses to queue when the queue isn't configured", async () => {
    const before = process.env.SSR_CONTROL_QUEUE_URL;
    delete process.env.SSR_CONTROL_QUEUE_URL;
    const real = await vi.importActual<typeof import("@/lib/appFunctions/ssrControl")>("@/lib/appFunctions/ssrControl");
    await expect(real.queueSsrControl({ kind: "publish", templateId: "t1" })).rejects.toThrow(/SSR_CONTROL_QUEUE_URL/);
    if (before !== undefined) process.env.SSR_CONTROL_QUEUE_URL = before;
  });
});

describe("ssr-publish route", () => {
  const ctx = { params: Promise.resolve({ id: "t1" }) };
  beforeEach(() => {
    queued.mockClear();
    patched.mockClear();
    app = null;
  });

  it("refuses to publish when there's no preview, and queues nothing", async () => {
    const res = await POST(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-publish", { method: "POST" }), ctx);
    expect(res.status).toBe(409);
    expect(queued).not.toHaveBeenCalled();
  });

  it("queues the publish and answers 202 when a preview exists", async () => {
    app = { previewBundleKey: "k", previewBuildId: "b1", previewSitePrefix: "p" };
    const res = await POST(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-publish", { method: "POST" }), ctx);
    expect(res.status).toBe(202);
    expect(queued).toHaveBeenCalledWith({ kind: "publish", templateId: "t1" });
    expect(patched.mock.calls[0][0]).toMatchObject({ publishError: "" });
  });

  it("reports a publish still running, then its outcome", async () => {
    app = { publishRequestedAt: "2026-11-05T10:00:00.000Z" };
    const running = await (await GET(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-publish"), ctx)).json();
    expect(running.publishing).toBe(true);
    app = { publishRequestedAt: "2026-11-05T10:00:00.000Z", publishFinishedAt: "2026-11-05T10:02:00.000Z", publishWarnings: "[\"w\"]" };
    const done = await (await GET(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-publish"), ctx)).json();
    expect(done).toMatchObject({ publishing: false, error: null, warnings: ["w"] });
  });
});
