import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/projectEntities", () => ({ GitHubInstallation: {} }));
vi.mock("@/lib/projects/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects/github/client")>()),
  installationToken: async () => "test-token",
}));

import { GitHubError } from "@/lib/projects/github/client";
import { downloadRepoZip } from "@/lib/projects/github/archive";
import { signInstallState, verifyInstallState } from "@/lib/projects/github/install";
import { isSafeReturnPath, isValidGitRef, isValidRepoFullName } from "@/lib/projects/github/validate";
import { SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://plexo.example.test");
  vi.stubEnv("PLEXO_GITHUB_RELAY_ORIGIN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isSafeReturnPath", () => {
  it("accepts in-app dashboard paths", () => {
    expect(isSafeReturnPath("/dashboard/new")).toBe(true);
    expect(isSafeReturnPath("/dashboard/apps/abc?panel=github")).toBe(true);
  });

  it("rejects anything that could leave the app", () => {
    expect(isSafeReturnPath("//evil.example")).toBe(false);
    expect(isSafeReturnPath("/\\evil.example")).toBe(false);
    expect(isSafeReturnPath("https://evil.example/dashboard/new")).toBe(false);
    expect(isSafeReturnPath("/dashboard/new\r\nSet-Cookie: x=1")).toBe(false);
    expect(isSafeReturnPath("/settings")).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
  });
});

describe("repo and ref checks", () => {
  it("accepts owner/name and rejects path tricks", () => {
    expect(isValidRepoFullName("acme/site-v2")).toBe(true);
    expect(isValidRepoFullName("acme/site/extra")).toBe(false);
    expect(isValidRepoFullName("acme/..")).toBe(false);
    expect(isValidRepoFullName("../site")).toBe(false);
    expect(isValidRepoFullName("")).toBe(false);
  });

  it("accepts branch names with slashes and rejects ..", () => {
    expect(isValidGitRef("main")).toBe(true);
    expect(isValidGitRef("feature/checkout")).toBe(true);
    expect(isValidGitRef("a/../b")).toBe(false);
    expect(isValidGitRef("/main")).toBe(false);
  });
});

describe("install state", () => {
  it("round-trips a wizard install with no app id and a return path", () => {
    const state = signInstallState({ appId: null, organizationId: "org1", userId: "u1", returnTo: "/dashboard/new" });
    expect(verifyInstallState(state)).toMatchObject({ appId: null, organizationId: "org1", userId: "u1", returnTo: "/dashboard/new" });
  });

  it("keeps the app id for installs started from an app", () => {
    const state = signInstallState({ appId: "app1", organizationId: "org1", userId: "u1" });
    expect(verifyInstallState(state)).toMatchObject({ appId: "app1", returnTo: null });
  });

  it("rejects a tampered state", () => {
    const state = signInstallState({ appId: null, organizationId: "org1", userId: "u1", returnTo: "/dashboard/new" });
    const [payload, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), organizationId: "org2" })).toString("base64url");
    expect(verifyInstallState(`${forged}.${sig}`)).toBeNull();
  });
});

describe("downloadRepoZip", () => {
  it("asks GitHub for the branch, keeping slashes in the branch name", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await downloadRepoZip(7, "acme/site", "feature/checkout");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/acme/site/zipball/feature/checkout");
  });

  it("explains a missing repo or branch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const err = await downloadRepoZip(7, "acme/site", "nope").catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/repository or branch/);
  });

  it("refuses a repo whose download is over the server app limit, before reading it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0]), { headers: { "content-length": String(SSR_MAX_ZIP_BYTES + 1) } })));
    const err = await downloadRepoZip(7, "acme/site", "main").catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(413);
  });
});
