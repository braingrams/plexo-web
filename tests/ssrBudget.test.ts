import { describe, it, expect } from "vitest";
import { SSR_BUILD_PROJECTED_COST_USD, fitsBudget, monthKey } from "@/lib/projects/ssrBudget";
import { getTierFeatures } from "@/lib/subscription";
import { ssrFunctionName } from "@/lib/appFunctions/ssrNames";
import { ssrFunctionScope } from "../cdk/lib/ssrScope";
import { SSR_DISABLED_FRAMEWORKS } from "@/lib/projects/ssrSource";

describe("SSR monthly budget", () => {
  it("projects $0.06 per build: 4 GB for the 15-minute build limit", () => {
    expect(SSR_BUILD_PROJECTED_COST_USD).toBe(0.06);
  });

  it("allows builds up to the budget and no further", () => {
    expect(fitsBudget(0, 6)).toBe(true);
    expect(fitsBudget(5.94, 6)).toBe(true); // the 100th build exactly reaches $6.00
    expect(fitsBudget(6, 6)).toBe(false); // 101st build
  });

  it("doesn't drift on floating-point sums", () => {
    let used = 0;
    let builds = 0;
    while (fitsBudget(used, 6)) {
      used += SSR_BUILD_PROJECTED_COST_USD;
      builds++;
    }
    expect(builds).toBe(100);
  });

  it("allows no builds when the plan has no budget", () => {
    expect(fitsBudget(0, 0)).toBe(false);
  });

  it("uses calendar months in UTC", () => {
    expect(monthKey(new Date("2026-11-01T00:30:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
  });
});

describe("SSR plan access", () => {
  it("only ULTRA can use SSR, with a $6 monthly budget", () => {
    expect(getTierFeatures("FREE")).toMatchObject({ ssrEnabled: false, ssrMonthlyBudgetUsd: 0 });
    expect(getTierFeatures("PRO")).toMatchObject({ ssrEnabled: false, ssrMonthlyBudgetUsd: 0 });
    expect(getTierFeatures("ULTRA")).toMatchObject({ ssrEnabled: true, ssrMonthlyBudgetUsd: 6 });
  });
  it("treats an unknown plan as FREE", () => {
    expect(getTierFeatures("MYSTERY").ssrEnabled).toBe(false);
  });
});

describe("SSR functions and switches", () => {
  it("names the live and preview functions, both under Lambda's 64-character limit", () => {
    const longest = "a".repeat(50);
    expect(ssrFunctionName("tmpl-1", "live", "")).toBe("plexo-ssr-tmpl-1");
    expect(ssrFunctionName("tmpl-1", "preview", "")).toBe("plexo-ssr-tmpl-1-pv");
    expect(ssrFunctionName(longest, "preview", "pr173").length).toBeLessThanOrEqual(64);
    expect(ssrFunctionName(longest, "live", "pr173").length).toBeLessThanOrEqual(64);
  });
  it("scopes names by stack so a PR preview never shares a name with staging", () => {
    expect(ssrFunctionName("tmpl-1", "live", "pr173")).toBe("plexo-ssr-pr173-tmpl-1");
    expect(ssrFunctionName("tmpl-1", "live", "stg")).not.toBe(ssrFunctionName("tmpl-1", "live", "pr173"));
  });
  it("tags PR stacks by number, staging and production by name", () => {
    expect(ssrFunctionScope("pr-173-plexo")).toBe("pr173");
    expect(ssrFunctionScope("staging-plexo")).toBe("stg");
    expect(ssrFunctionScope("production-plexo")).toBe("prod");
  });
  it("keeps long names unique with a hash of the whole id", () => {
    const a = "a".repeat(50);
    const b = "a".repeat(49) + "b";
    expect(ssrFunctionName(a, "live", "pr173")).not.toBe(ssrFunctionName(b, "live", "pr173"));
  });
  it("has no frameworks switched off at upload", () => {
    expect(SSR_DISABLED_FRAMEWORKS).toEqual([]);
  });
});

describe("SSR image function names", () => {
  it("adds -img before the preview suffix, and stays within Lambda's limit", () => {
    expect(ssrFunctionName("tmpl-1", "live", "stg", "image")).toBe("plexo-ssr-stg-tmpl-1-img");
    expect(ssrFunctionName("tmpl-1", "preview", "stg", "image")).toBe("plexo-ssr-stg-tmpl-1-img-pv");
    expect(ssrFunctionName("a".repeat(50), "preview", "pr173", "image").length).toBeLessThanOrEqual(64);
  });
});
