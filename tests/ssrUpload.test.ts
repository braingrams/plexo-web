import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Stored objects live in a map, so the route's reads and writes can be checked.
const store = new Map<string, Buffer>();
vi.mock("@/lib/appFunctions/ssrGuard", () => ({ guardSsrSettings: async () => ({ ok: true }) }));
vi.mock("@/lib/projects/blobStore", () => ({
  projectPrefix: (templateId: string) => `private/projects/${templateId}`,
  putObject: async (key: string, body: Buffer) => { store.set(key, Buffer.from(body)); },
  getObject: async (key: string) => (store.has(key) ? { body: store.get(key)! } : null),
  deletePrefix: async (prefix: string) => { for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key); },
}));

import { isSsrUploadKey } from "@/lib/projects/ssrUpload";
import { POST } from "@/app/api/v1/templates/[id]/ssr-upload/chunk/route";

const SESSION = "3f2b1c4e-8a9d-4b7e-9c1a-2d3e4f5a6b7c";
const MB = 1024 * 1024;

function part(index: number, total: number, body: Buffer, session = SESSION) {
  return POST(
    new NextRequest("https://plexo.test/api/v1/templates/t1/ssr-upload/chunk", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-upload-session": session, "x-chunk-index": String(index), "x-chunk-total": String(total) },
      body: new Uint8Array(body),
    }),
    { params: Promise.resolve({ id: "t1" }) },
  );
}

describe("isSsrUploadKey", () => {
  it("accepts a key the chunk route assembled for this app", () => {
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/${SESSION}.zip`)).toBe(true);
  });
  it("refuses another app's key, the source key, and path tricks", () => {
    expect(isSsrUploadKey("t1", `private/projects/t2/ssr/uploads/${SESSION}.zip`)).toBe(false);
    expect(isSsrUploadKey("t1", "private/projects/t1/ssr/latest.zip")).toBe(false);
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/../../latest.zip`)).toBe(false);
    expect(isSsrUploadKey("t1", `private/projects/t1/ssr/uploads/${SESSION}.zip/../x`)).toBe(false);
    expect(isSsrUploadKey("t1", "")).toBe(false);
  });
});

describe("POST ssr-upload/chunk", () => {
  beforeEach(() => store.clear());

  it("assembles a single-part zip, and clears the parts", async () => {
    const body = Buffer.from("zip-bytes");
    const res = await part(0, 1, body);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ status: "assembled", uploadKey: `private/projects/t1/ssr/uploads/${SESSION}.zip` });
    expect(store.get(data.uploadKey)!.equals(body)).toBe(true);
    expect([...store.keys()].some((key) => key.includes(`/${SESSION}/`))).toBe(false);
  });

  it("holds earlier parts until the last one, then assembles them in order", async () => {
    expect(await (await part(0, 2, Buffer.from("aaa"))).json()).toEqual({ status: "received", chunkIndex: 0 });
    const data = await (await part(1, 2, Buffer.from("bbb"))).json();
    expect(store.get(data.uploadKey)!.toString()).toBe("aaabbb");
  });

  it("refuses a missing part at assembly, and clears what it has", async () => {
    await part(1, 2, Buffer.from("bbb"));
    const res = await part(1, 2, Buffer.from("bbb"));
    expect(res.status).toBe(400);
    expect([...store.keys()].length).toBe(0);
  });

  it("refuses bad headers and oversized parts", async () => {
    expect((await part(0, 1, Buffer.from("x"), "not-a-uuid")).status).toBe(400);
    expect((await part(2, 2, Buffer.from("x"))).status).toBe(400);
    expect((await part(0, 35, Buffer.from("x"))).status).toBe(400);
    expect((await part(0, 1, Buffer.alloc(3 * MB + 1))).status).toBe(400);
  });

  it("refuses an assembled zip over 100MB", async () => {
    const piece = Buffer.alloc(3 * MB);
    for (let i = 0; i < 33; i++) await part(i, 34, piece);
    const res = await part(33, 34, piece);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/100MB limit/) });
  });
});
