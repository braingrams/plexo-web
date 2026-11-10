import { describe, it, expect } from "vitest";
import { capCacheControl, SERVER_RESPONSE_MAX_AGE_SECONDS } from "@/lib/pub/capCacheControl";

describe("capCacheControl (server app responses)", () => {
  it("lowers a one-year s-maxage from a prerendered page to the cap", () => {
    expect(capCacheControl("s-maxage=31536000, stale-while-revalidate")).toBe(`s-maxage=${SERVER_RESPONSE_MAX_AGE_SECONDS}, stale-while-revalidate`);
  });

  it("lowers max-age too, keeping public and immutable as sent", () => {
    expect(capCacheControl("public, max-age=31536000, immutable")).toBe("public, max-age=60, immutable");
  });

  it("leaves values already within the cap alone", () => {
    expect(capCacheControl("public, s-maxage=30, max-age=0, must-revalidate")).toBe("public, s-maxage=30, max-age=0, must-revalidate");
  });

  it("never touches no-cache, no-store or private responses", () => {
    expect(capCacheControl("private, no-cache, no-store, max-age=0")).toBe("private, no-cache, no-store, max-age=0");
  });

  it("tolerates odd spacing and case in directive names", () => {
    expect(capCacheControl(" public ,S-MAXAGE=99999 ")).toBe("public, s-maxage=60");
  });

  it("respects an explicit cap", () => {
    expect(capCacheControl("s-maxage=500", 300)).toBe("s-maxage=300");
  });
});
