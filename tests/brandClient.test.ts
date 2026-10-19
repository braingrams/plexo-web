import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { BrandTransferError, fetchBrand, uploadBrand } from "@/lib/v2/brandClient";
import { buildV2SavePayload } from "@/app/dashboard/templates/[id]/v2/logic";

// The editor's side of a big brand: straight to storage and straight back, with only a small reference in the page save.

const brand = () => {
  const ds = createDefaultDesignSystem();
  ds.tokens = [...ds.tokens, ...Array.from({ length: 3000 }, (_, i) => ({ key: `--color-bulk-${i}`, name: `Bulk ${i}`, value: "#123456", type: "color", unit: null, layer: "brand" as const, comment: "" }))];
  return ds;
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("uploadBrand", () => {
  it("gzips the brand, asks for a one-off upload form, posts the file last, and returns the reference to save", async () => {
    const ds = brand();
    let upload: FormData | null = null;
    let asked: { hash: string; size: number } | null = null;
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/templates/design-system") {
        asked = JSON.parse(String(init!.body));
        return json(200, { url: "https://bucket.test/up", fields: { key: "k", "Content-Type": "application/gzip" } });
      }
      upload = init!.body as FormData;
      return new Response(null, { status: 204 });
    });
    const ref = await uploadBrand(ds, f as never);
    expect(ref.size).toBe(JSON.stringify(ds).length);
    expect(ref.hash).toBe(asked!.hash);
    const file = upload!.get("file") as File;
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ref.hash); // the name is the hash of the bytes
    expect(JSON.parse(gunzipSync(bytes).toString("utf8")).tokens).toHaveLength(ds.tokens.length);
    expect([...upload!.keys()].at(-1)).toBe("file"); // S3 needs the file part last
    expect(upload!.get("key")).toBe("k");
  });

  it("uploads nothing when that exact brand is already stored", async () => {
    const f = vi.fn(async () => json(200, { stored: true }));
    await uploadBrand(brand(), f as never);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("says what went wrong in plain words", async () => {
    await expect(uploadBrand(brand(), (async () => json(413, { error: "Remove unused colours." })) as never)).rejects.toThrow("Remove unused colours.");
    const f = vi.fn(async (url: RequestInfo | URL) => (String(url).startsWith("/api") ? json(200, { url: "https://b/up", fields: {} }) : new Response("no", { status: 403 })));
    await expect(uploadBrand(brand(), f as never)).rejects.toBeInstanceOf(BrandTransferError);
  });
});

describe("fetchBrand", () => {
  it("loads a stored brand straight from its link and un-gzips it", async () => {
    const { gzipSync } = await import("node:zlib");
    const ds = brand();
    const f = vi.fn(async () => new Response(gzipSync(JSON.stringify(ds)), { status: 200 }));
    expect((await fetchBrand("https://bucket.test/get/x", f as never)).tokens).toHaveLength(ds.tokens.length);
  });
  it("fails with plain messages for a dead link or a file that isn't a brand", async () => {
    await expect(fetchBrand("u", (async () => new Response("", { status: 403 })) as never)).rejects.toThrow(/Reload the page/);
    await expect(fetchBrand("u", (async () => new Response("garbage", { status: 200 })) as never)).rejects.toThrow(/couldn't be read/);
  });
});

describe("saving a page with a big brand", () => {
  it("sends only the small reference, not the brand", () => {
    const ds = brand();
    const ref = { hash: "d".repeat(64), size: 999_999 };
    const design = buildV2SavePayload({ page: { id: "p", name: "Home", slug: "home", rootNode: { id: "r", type: "page", name: "Home", styles: {} } } as never, designSystem: ds, includeDesignSystem: true, designSystemRef: ref });
    expect(design.designSystemRef).toEqual(ref);
    expect(design.designSystem).toBeUndefined();
    expect(JSON.stringify(design).length).toBeLessThan(2000);
  });
});
