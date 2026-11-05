import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/appFunctions/ssrGuard", () => ({ guardSsrSettings: async () => ({ ok: true }) }));
const createProjectUploadPost = vi.fn(async (key: string, _opts: unknown) => ({ url: "https://bucket.test/", fields: { key, "Content-Type": "application/zip" } }));
vi.mock("@/lib/projects/blobStore", () => ({
  projectPrefix: (templateId: string) => `private/projects/${templateId}`,
  createProjectUploadPost: (key: string, opts: unknown) => createProjectUploadPost(key, opts),
}));

import { isSsrUploadKey, newSsrUploadKey } from "@/lib/projects/ssrUpload";
import { POST as slot } from "@/app/api/v1/templates/[id]/ssr-upload/route";

const UUID = "3f2b1c4e-8a9d-4b7e-9c1a-2d3e4f5a6b7c";

describe("isSsrUploadKey", () => {
  it("accepts a key the upload route issued for this app", () => {
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/${UUID}.zip`)).toBe(true);
    expect(newSsrUploadKey("t1")).toMatch(/^private\/projects\/t1\/ssr\/uploads\/[0-9a-f-]{36}\.zip$/);
  });
  it("refuses another app's key, the source key, and path tricks", () => {
    expect(isSsrUploadKey("t1", `private/projects/t2/ssr/uploads/${UUID}.zip`)).toBe(false);
    expect(isSsrUploadKey("t1", "private/projects/t1/ssr/latest.zip")).toBe(false);
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/../../latest.zip`)).toBe(false);
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/${UUID}.zip/../x`)).toBe(false);
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/notauuid.zip`)).toBe(false);
    expect(isSsrUploadKey("t1", "")).toBe(false);
  });
});

describe("POST ssr-upload", () => {
  const post = (body: unknown) =>
    slot(new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-upload", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: "t1" }) });

  beforeEach(() => createProjectUploadPost.mockClear());

  it("returns a presigned upload for a zip within the limit", async () => {
    const res = await post({ filename: "site.zip", size: 6 * 1024 * 1024 });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uploadKey).toMatch(/^private\/projects\/t1\/ssr\/uploads\/.+\.zip$/);
    expect(data.url).toBe("https://bucket.test/");
    expect(createProjectUploadPost).toHaveBeenCalledWith(data.uploadKey, expect.objectContaining({ maxBytes: 100 * 1024 * 1024 }));
  });

  it("refuses a file that isn't a zip, or a missing or oversized size", async () => {
    expect((await post({ filename: "site.tar", size: 10 })).status).toBe(400);
    expect((await post({ filename: "site.zip" })).status).toBe(400);
    expect((await post({ filename: "site.zip", size: 101 * 1024 * 1024 })).status).toBe(400);
    expect(createProjectUploadPost).not.toHaveBeenCalled();
  });
});
