import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDefaultDesignSystem, type DesignSystem } from "@charisol/plexo-sdk/v2/compile";

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1", organizationId: "o1", role: null }) }));

import { INLINE_MAX_CHARS, MAX_STORED_DESIGN_SYSTEM_BYTES, DesignSystemStoreError, designSystemExists, externalizeDesignSystem, loadDesignSystem, resolveDesignSystem, setDesignSystemBackend, storeDesignSystem, type DesignSystemBackend } from "@/lib/v2/designSystemStore";
import { blankV2Design, parseV2Design } from "@/lib/v2/design";
import { compileV2Design } from "@/lib/v2/compile";
import { compileTemplate } from "@/lib/compileTemplate";
import { POST as presign } from "@/app/api/templates/design-system/route";

const objects = new Map<string, Buffer>();
const backend: DesignSystemBackend = {
  has: vi.fn(async (h) => objects.has(h)),
  put: vi.fn(async (h, gz) => void objects.set(h, gz)),
  get: vi.fn(async (h) => objects.get(h) ?? null),
  presignUpload: vi.fn(async (h) => ({ url: `https://bucket.test/${h}`, fields: { key: h } })),
  presignDownload: vi.fn(async (h) => `https://bucket.test/get/${h}`),
};
const bigBrand = (tokens: number): DesignSystem => {
  const ds = createDefaultDesignSystem();
  ds.name = "Big";
  ds.tokens = [...ds.tokens, ...Array.from({ length: tokens }, (_, i) => ({ key: `--color-bulk-${i}`, name: `Bulk ${i}`, value: "#123456", type: "color", unit: null, layer: "brand" as const, comment: "from Strata" }))];
  return ds;
};

beforeEach(() => {
  objects.clear();
  vi.mocked(backend.put).mockClear();
  setDesignSystemBackend(backend);
});

describe("a big brand lives in storage, not in the page's row", () => {
  it("round-trips: stored under its own hash, loaded back whole, verified", async () => {
    const ds = bigBrand(20_000);
    const ref = await storeDesignSystem(ds);
    expect(ref.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ref.size).toBe(JSON.stringify(ds).length);
    setDesignSystemBackend(backend); // forget the in-process copy: read it back from storage
    expect((await loadDesignSystem(ref)).tokens).toHaveLength(ds.tokens.length);
  });

  it("a small brand stays in the row; a big one is replaced by a short reference; a stored page resolves back", async () => {
    const small = { ...blankV2Design(), designSystem: createDefaultDesignSystem() };
    expect(await externalizeDesignSystem(small)).toBe(small);
    const big = { ...blankV2Design(), designSystem: bigBrand(2_000) };
    expect(JSON.stringify(big.designSystem).length).toBeGreaterThan(INLINE_MAX_CHARS);
    const stored = await externalizeDesignSystem(big);
    expect(stored.designSystem).toBeUndefined();
    expect(stored.designSystemRef?.size).toBeGreaterThan(INLINE_MAX_CHARS);
    expect(JSON.stringify(stored).length).toBeLessThan(40_000); // the row no longer carries the brand
    const back = await resolveDesignSystem(stored);
    expect(back.designSystem?.tokens.length).toBe(big.designSystem.tokens.length);
    expect(back.designSystemRef).toBeUndefined();
  });

  it("the page validator accepts a reference, and the compiler refuses to quietly use the default brand without the real one", async () => {
    const ref = await storeDesignSystem(bigBrand(2_000));
    const parsed = parseV2Design({ ...blankV2Design(), designSystemRef: ref });
    expect(parsed).toMatchObject({ ok: true, design: { designSystemRef: ref } });
    expect(() => compileV2Design({ ...blankV2Design(), designSystemRef: ref }, { rootTemplateId: "r", pageTemplateId: "p", name: "Home" })).toThrow(/couldn't be loaded/);
    const html = await compileTemplate({ designFormat: "v2", designJson: { ...blankV2Design(), designSystemRef: ref }, kind: "LANDING_PAGE", id: "p", name: "Home" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(parseV2Design({ ...blankV2Design(), designSystemRef: { hash: "nope", size: 1 } })).toMatchObject({ ok: true, design: expect.not.objectContaining({ designSystemRef: expect.anything() }) });
  });

  it("refuses a reference whose object is missing, isn't what its name says, or isn't a brand — with plain messages", async () => {
    const ghost = { hash: "a".repeat(64), size: 10 };
    await expect(externalizeDesignSystem({ ...blankV2Design(), designSystemRef: ghost })).rejects.toThrow(/didn't finish uploading/);
    const gz = gzipSync(JSON.stringify(createDefaultDesignSystem()));
    objects.set("b".repeat(64), gz); // stored under a name that isn't its hash
    await expect(loadDesignSystem({ hash: "b".repeat(64), size: 1 })).rejects.toThrow(/didn't upload correctly/);
    const junk = gzipSync("not json");
    const jh = createHash("sha256").update(junk).digest("hex");
    objects.set(jh, junk);
    await expect(loadDesignSystem({ hash: jh, size: 1 })).rejects.toBeInstanceOf(DesignSystemStoreError);
  });

  it("re-writing identical content refreshes it (so cleanup never removes what a page just saved)", async () => {
    const ds = bigBrand(50);
    await storeDesignSystem(ds);
    await storeDesignSystem(ds);
    expect(backend.put).toHaveBeenCalledTimes(2);
    expect(objects.size).toBe(1);
  });
});

describe("the upload door", () => {
  const post = (body: unknown) => presign(new NextRequest("https://plexo.test/api/templates/design-system", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  it("hands out a one-off upload form, says 'already stored' when it is, and refuses nonsense or oversize", async () => {
    const hash = "c".repeat(64);
    const a = await (await post({ hash, size: 5_000_000 })).json();
    expect(a).toEqual({ url: `https://bucket.test/${hash}`, fields: { key: hash } });
    objects.set(hash, Buffer.from("x"));
    expect(await (await post({ hash, size: 5_000_000 })).json()).toEqual({ stored: true });
    expect((await post({ hash: "short", size: 10 })).status).toBe(400);
    expect((await post({ hash, size: 0 })).status).toBe(400);
    expect((await post({ hash, size: MAX_STORED_DESIGN_SYSTEM_BYTES + 1 })).status).toBe(413);
    expect(await designSystemExists(hash)).toBe(true);
  });
});
