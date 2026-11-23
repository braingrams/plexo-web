import { describe, expect, it } from "vitest";
import { looksLikeBrowserPost, machineSource } from "@/lib/forms/trafficGuards";
import { isLikelySpam, spamReasons } from "@/lib/forms/spamHeuristics";

const malcare = {
  Aftershutdown: "true", Apipage: "blogvault", B64: "bvprms, bvprms", BvMethod: "getdata", BvTime: "1795454647", BvVersion: "0.1", Bvb64: "true",
  Bvplugname: "malcare", Bvprms: "12", "Bvprms bv 1": "ZXlK", Bvprmsmac: "6f66", Bvreqmerge: "true", Checksum: "md5", Concat: "bvprms", Memset: "512",
  Pubkey: "d6e1", Sersafe: "bvprms", Sha1: "true", Sig: "OwNL", Sighshalgo: "1", Unser: "bvprms", Wing: "wtch",
};
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("recognising machine calls", () => {
  it("MalCare / BlogVault calls, with or without their usual field names", () => {
    expect(machineSource(malcare)).toBe("MalCare / BlogVault");
    expect(machineSource({ BvMethod: "dummyping", Bvplugname: "malcare" })).toBe("MalCare / BlogVault");
    expect(machineSource({ Apipage: "blogvault", x: "y" })).toBe("MalCare / BlogVault");
  });
  it("a signed service call", () => {
    expect(machineSource({ sig: "abc", pubkey: "def", other: "1" })).toBe("a signed service call");
  });
  it("never a real visitor's form", () => {
    expect(machineSource({ "Your Name": "Uche", Email: "uche@charisol.io", Category: "Mobile App Development", "Other needs": "A landing page" })).toBeNull();
    expect(machineSource({ name: "Ada", message: "Do you ship to Accra?", signature: "Ada" })).toBeNull();
  });
  it("is flagged in the inbox for the rows already stored", () => {
    expect(isLikelySpam(malcare as Record<string, string>)).toBe(true);
    expect(spamReasons(malcare as Record<string, string>)[0]).toMatch(/MalCare/);
  });
});

describe("telling a browser from a server", () => {
  it("a browser form on this site says so", () => {
    expect(looksLikeBrowserPost(headers({ "sec-fetch-site": "same-origin" }), "charisol.io")).toBe(true);
    expect(looksLikeBrowserPost(headers({ origin: "https://charisol.io" }), "charisol.io")).toBe(true);
    expect(looksLikeBrowserPost(headers({ referer: "https://www.charisol.io/about/" }), "charisol.io")).toBe(true);
    expect(looksLikeBrowserPost(headers({ origin: "https://charisol.io" }), "www.charisol.io")).toBe(true);
  });
  it("a server posting straight to a page, or a page elsewhere, does not", () => {
    expect(looksLikeBrowserPost(headers({}), "charisol.io")).toBe(false);
    expect(looksLikeBrowserPost(headers({ origin: "https://evil.example" }), "charisol.io")).toBe(false);
    expect(looksLikeBrowserPost(headers({ origin: "null" }), "charisol.io")).toBe(false);
    expect(looksLikeBrowserPost(headers({ "sec-fetch-site": "cross-site" }), "charisol.io")).toBe(false);
  });
});
