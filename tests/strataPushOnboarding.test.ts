import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/coreEntities", () => ({ User: {} }));

import { completeOnboardingForStrataPush, needsOnboardingMark, type StrataPushDeps } from "@/lib/onboarding/strataPush";
import { CURRENT_ONBOARDING_VERSION, v3EntryDestination } from "@/lib/dashboardV3/flag";

const make = (user: { onboardingVersion?: number | null } | null) => {
  const saved: unknown[] = [];
  const deps: StrataPushDeps = { load: async () => user, save: async (_id, patch) => { saved.push(patch); user = { ...(user ?? {}), ...patch }; } };
  return { deps, saved };
};

describe("pushing a brand from Strata finishes onboarding", () => {
  it("marks a new person done so they land on Home, not the setup wizard", async () => {
    const { deps, saved } = make({ onboardingVersion: 0 });
    expect(v3EntryDestination({ onboardingVersion: 0 })).toBe("onboarding");
    expect(await completeOnboardingForStrataPush("u1", deps)).toEqual({ changed: true });
    expect(saved).toEqual([{ onboardingVersion: CURRENT_ONBOARDING_VERSION }]);
    expect(v3EntryDestination({ onboardingVersion: CURRENT_ONBOARDING_VERSION })).toBe("home");
  });
  it("is idempotent: a second push, or someone already done, changes nothing", async () => {
    const { deps, saved } = make({});
    await completeOnboardingForStrataPush("u1", deps);
    expect(await completeOnboardingForStrataPush("u1", deps)).toEqual({ changed: false });
    expect(saved).toHaveLength(1);
    const done = make({ onboardingVersion: CURRENT_ONBOARDING_VERSION + 1 });
    expect((await completeOnboardingForStrataPush("u2", done.deps)).changed).toBe(false);
    expect(done.saved).toEqual([]);
  });
  it("never fails the publish: a missing user or a failing save is swallowed", async () => {
    expect(needsOnboardingMark(null)).toBe(false);
    expect((await completeOnboardingForStrataPush("x", make(null).deps)).changed).toBe(false);
    const boom: StrataPushDeps = { load: async () => ({}), save: async () => { throw new Error("db down"); } };
    expect((await completeOnboardingForStrataPush("x", boom)).changed).toBe(false);
  });
});
