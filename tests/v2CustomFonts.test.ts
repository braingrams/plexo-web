import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildPageFromTemplate, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

const uploaded: { path: string; type: string }[] = [];
let signedIn = true;
vi.mock("@/lib/storage", () => ({
  StorageError: class extends Error {},
  userContentOrigin: () => "https://bucket.s3.eu-west-1.amazonaws.com",
  uploadObject: async (path: string, _b: Buffer, o: { contentType: string }) => {
    uploaded.push({ path, type: o.contentType });
    return { url: `https://bucket.s3.eu-west-1.amazonaws.com/public/${path}` };
  },
}));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => (signedIn ? { userId: "u1", organizationId: "o1" } : null) }));

import { POST } from "@/app/api/v1/media/font/route";
import { compileV2Design } from "@/lib/v2/compile";
import { V2_FORMAT } from "@/lib/v2/design";

const send = async (name: string, bytes: Buffer) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name));
  const res = await POST(new Request("http://x/api/v1/media/font", { method: "POST", body: form }) as never);
  return { status: res.status, json: await res.json() };
};
const woff2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(40)]);

beforeEach(() => {
  uploaded.length = 0;
  signedIn = true;
});

describe("font upload route", () => {
  it("stores a real font and returns its public address", async () => {
    const r = await send("Brand Sans.woff2", woff2);
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/\/public\/fonts\/u1\/[a-z0-9]{12}\.woff2$/);
    expect(uploaded[0].type).toBe("font/woff2");
  });
  it("refuses other file types, fake fonts and big files with plain words", async () => {
    expect((await send("x.png", woff2)).json.error).toMatch(/\.woff2/);
    const fake = await send("x.woff2", Buffer.from("not a font at all, just text"));
    expect(fake.status).toBe(400);
    expect(fake.json.error).toMatch(/real \.woff2 font/);
    const big = await send("x.woff2", Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(3 * 1024 * 1024)]));
    expect(big.json.error).toMatch(/3 MB/);
    expect(uploaded).toHaveLength(0);
  });
  it("needs a signed-in user", async () => {
    signedIn = false;
    expect((await send("x.woff2", woff2)).status).toBe(401);
  });
});

describe("published pages carry the fonts", () => {
  const withFonts = (fonts: unknown) => {
    const ds = { ...createDefaultDesignSystem(), fonts } as never;
    const page = buildPageFromTemplate("landing", { name: "Home", slug: "home", designSystem: ds });
    page.rootNode.styles = { ...page.rootNode.styles, fontFamily: "Brand Sans" };
    return compileV2Design({ format: V2_FORMAT, pages: [page], designSystem: ds }, { name: "x", rootTemplateId: "t", templateId: "t" } as never);
  };
  it("uses the font stylesheet link in head for Google fonts", () => {
    const page = buildPageFromTemplate("landing", { name: "Home", slug: "home" });
    page.rootNode.styles = { ...page.rootNode.styles, fontFamily: "Playfair Display" };
    const html = compileV2Design({ format: V2_FORMAT, pages: [page] }, { name: "x", rootTemplateId: "t", templateId: "t" } as never);
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Playfair+Display");
  });
  it("keeps an uploaded font's @font-face only for the owner's own storage", () => {
    const own = "https://bucket.s3.eu-west-1.amazonaws.com/public/fonts/u1/abc123def456.woff2";
    const html = withFonts([{ family: "Brand Sans", variants: [{ weight: 400, style: "normal", url: own, format: "woff2" }] }]);
    expect(html).toContain("@font-face");
    expect(html).toContain(own);
    const evil = withFonts([{ family: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://evil.example/f.woff2", format: "woff2" }] }]);
    expect(evil).not.toContain("evil.example");
  });
});
