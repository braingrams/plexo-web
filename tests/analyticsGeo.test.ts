import { describe, expect, it } from "vitest";
import { extractGeoFromHeaders } from "@/server/analytics";

const h = (o: Record<string, string>) => new Headers(o);

describe("visitor location", () => {
  it("reads CloudFront's headers (how Plexo is served on AWS)", () => {
    expect(extractGeoFromHeaders(h({ "cloudfront-viewer-country": "NG", "cloudfront-viewer-country-region": "LA", "cloudfront-viewer-city": "Lagos" })))
      .toEqual({ country: "NG", region: "LA", city: "Lagos" });
  });
  it("keeps non-ASCII city names and survives a stray percent sign", () => {
    expect(extractGeoFromHeaders(h({ "cloudfront-viewer-city": "São Paulo" })).city).toBe("São Paulo");
    expect(extractGeoFromHeaders(h({ "cloudfront-viewer-city": "100% Town" })).city).toBe("100% Town");
  });
  it("still understands Vercel's headers", () => {
    expect(extractGeoFromHeaders(h({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "TX", "x-vercel-ip-city": "Fort%20Worth" })))
      .toEqual({ country: "US", region: "TX", city: "Fort Worth" });
  });
  it("is empty (not broken) when no edge headers are present, e.g. local dev", () => {
    expect(extractGeoFromHeaders(h({}))).toEqual({ country: null, region: null, city: null });
  });
});
