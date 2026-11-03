import { describe, it, expect } from "vitest";
import {
  buildVariablesFor, buildVarsHash, isPublicName, previewOnlySecrets, runtimeBytes, runtimeVariablesFor,
  variableNameProblem, variableValueProblem, type StoredVariable,
} from "@/lib/appFunctions/ssrVariables";

const v = (name: string, value: string, scope: StoredVariable["scope"] = "all", buildTime = false): StoredVariable => ({ name, value, scope, buildTime });

describe("variable names and values", () => {
  it("accepts ordinary names and rejects reserved or malformed ones", () => {
    expect(variableNameProblem("API_BASE_URL")).toBeNull();
    expect(variableNameProblem("1BAD")).toMatch(/capital letters/);
    expect(variableNameProblem("AWS_REGION")).toMatch(/reserved/);
    expect(variableNameProblem("PLEXO_SERVICE_KEY")).toMatch(/reserved/);
  });
  it("limits a value to 4 KB", () => {
    expect(variableValueProblem("x".repeat(4096))).toBeNull();
    expect(variableValueProblem("x".repeat(4097))).toMatch(/4 KB/);
  });
});

describe("public prefixes", () => {
  it("treats browser-readable prefixes as public", () => {
    expect(isPublicName("NEXT_PUBLIC_SITE_NAME")).toBe(true);
    expect(isPublicName("VITE_API")).toBe(true);
    expect(isPublicName("STRIPE_SECRET_KEY")).toBe(false);
  });
});

describe("where each variable goes", () => {
  const vars = [
    v("API_BASE_URL", "https://api.example.com"),
    v("SITE_NAME", "Acme", "all", true),
    v("NEXT_PUBLIC_MAP_KEY", "pk_1"),
    v("PREVIEW_FLAG", "on", "dev"),
    v("LIVE_ONLY", "yes", "live"),
  ];

  it("puts build variables in the build for the right environment only", () => {
    expect(buildVariablesFor(vars, "dev")).toEqual({ SITE_NAME: "Acme", NEXT_PUBLIC_MAP_KEY: "pk_1" });
  });

  it("keeps the build set limited to build-time and public names", () => {
    const build = buildVariablesFor(vars, "live");
    expect(Object.keys(build).sort()).toEqual(["NEXT_PUBLIC_MAP_KEY", "SITE_NAME"]);
    expect(build).not.toHaveProperty("API_BASE_URL");
  });

  it("sets every variable that applies on the function's environment", () => {
    expect(Object.keys(runtimeVariablesFor(vars, "dev")).sort()).toEqual(["API_BASE_URL", "NEXT_PUBLIC_MAP_KEY", "PREVIEW_FLAG", "SITE_NAME"]);
    expect(Object.keys(runtimeVariablesFor(vars, "live")).sort()).toEqual(["API_BASE_URL", "LIVE_ONLY", "NEXT_PUBLIC_MAP_KEY", "SITE_NAME"]);
  });

  it("measures the function environment in bytes", () => {
    expect(runtimeBytes({ A: "xx", BB: "y" })).toBe(1 + 2 + 2 + 1);
  });
});

describe("build variable fingerprint", () => {
  it("is the same for the same values in any order, and differs when a value changes", () => {
    expect(buildVarsHash({ A: "1", B: "2" })).toBe(buildVarsHash({ B: "2", A: "1" }));
    expect(buildVarsHash({ A: "1" })).not.toBe(buildVarsHash({ A: "2" }));
  });
});

describe("publish warnings for secrets", () => {
  it("names secrets that exist for preview but have no live value", () => {
    expect(previewOnlySecrets([
      { name: "STRIPE_KEY", scope: "dev" },
      { name: "SMTP_PASS", scope: "dev" },
      { name: "SMTP_PASS", scope: "live" },
      { name: "SHARED", scope: "all" },
      { name: "SHARED", scope: "dev" },
    ])).toEqual(["STRIPE_KEY"]);
  });
});
