import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { resolveHostingTier } from "@/lib/pub/hostingTier";

const req = (q = "") => new NextRequest(`https://x.test/api/v1/templates/t1/deploy${q}`);

describe("resolveHostingTier", () => {
  it("defaults to LAMBDA when no tier is given", () => {
    expect(resolveHostingTier(req(), "PRO")).toEqual({ hostingTier: "LAMBDA" });
  });
  it("accepts a tier the plan includes, regardless of case", () => {
    expect(resolveHostingTier(req("?hostingTier=provisioned"), "ULTRA")).toEqual({ hostingTier: "PROVISIONED" });
  });
  it("refuses a tier the plan doesn't include with 403", () => {
    const result = resolveHostingTier(req("?hostingTier=PROVISIONED"), "FREE");
    expect("error" in result && result.error.status).toBe(403);
  });
});
