import { describe, it, expect } from "vitest";
import { parseSsrEnvBody, validateSsrEnvChange, SSR_ENV_MAX_BYTES } from "@/lib/appFunctions/ssrEnv";

describe("validateSsrEnvChange", () => {
  it("accepts a normal change", () => {
    expect(validateSsrEnvChange({ set: { API_URL: "https://x.test" }, unset: [] }, {})).toBeNull();
  });
  it("rejects bad names and AWS_ reserved names", () => {
    expect(validateSsrEnvChange({ set: { "1BAD": "x" }, unset: [] }, {})).toMatch(/isn't a valid variable name/);
    expect(validateSsrEnvChange({ set: { "BAD-NAME": "x" }, unset: [] }, {})).toMatch(/isn't a valid variable name/);
    expect(validateSsrEnvChange({ set: { AWS_REGION: "x" }, unset: [] }, {})).toMatch(/reserved/);
    expect(validateSsrEnvChange({ set: {}, unset: ["AWS_SECRET"] }, {})).toMatch(/reserved/);
  });
  it("enforces the 4KB total, counting what's already set", () => {
    const big = "x".repeat(SSR_ENV_MAX_BYTES - 1); // with key "A" this fills the limit exactly
    expect(validateSsrEnvChange({ set: { A: "x".repeat(10) }, unset: [] }, {})).toBeNull();
    expect(validateSsrEnvChange({ set: { B: "y" }, unset: [] }, { A: big })).toMatch(/limit is 4096/);
    expect(validateSsrEnvChange({ set: { B: "y" }, unset: ["A"] }, { A: big })).toBeNull();
  });
});

describe("parseSsrEnvBody", () => {
  it("reads set and unset", () => {
    expect(parseSsrEnvBody({ set: { A: "1" }, unset: ["B"] })).toEqual({ set: { A: "1" }, unset: ["B"] });
  });
  it("defaults missing parts to empty", () => {
    expect(parseSsrEnvBody({ set: { A: "1" } })).toEqual({ set: { A: "1" }, unset: [] });
  });
  it("rejects malformed bodies", () => {
    expect(parseSsrEnvBody(null)).toMatch(/Send a JSON/);
    expect(parseSsrEnvBody({ set: ["A"] })).toMatch(/must be an object/);
    expect(parseSsrEnvBody({ unset: [1] })).toMatch(/must be a list/);
  });
});
