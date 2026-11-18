import { describe, expect, it } from "vitest";
import { NUDGE_AFTER_VISITS, NUDGE_QUIET_DAYS, readNudgeState, shouldShowProNudge } from "@/lib/dashboardV3/proNudge";

const DAY = 86_400_000;
const now = 100 * DAY;

describe("the 'ready for more control?' card", () => {
  it("only for the guided view, and only after a few visits", () => {
    expect(shouldShowProNudge({ experience: "beginner", state: { visits: NUDGE_AFTER_VISITS - 1 }, now })).toBe(false);
    expect(shouldShowProNudge({ experience: "beginner", state: { visits: NUDGE_AFTER_VISITS }, now })).toBe(true);
    expect(shouldShowProNudge({ experience: "pro", state: { visits: 50 }, now })).toBe(false);
    expect(shouldShowProNudge({ experience: "intermediate", state: { visits: 50 }, now })).toBe(false);
  });
  it("after 'Not now' it stays away for two weeks, then may come back", () => {
    expect(shouldShowProNudge({ experience: "beginner", state: { visits: 9, dismissedAt: now - 3 * DAY }, now })).toBe(false);
    expect(shouldShowProNudge({ experience: "beginner", state: { visits: 9, dismissedAt: now - (NUDGE_QUIET_DAYS + 1) * DAY }, now })).toBe(true);
  });
  it("reads whatever is stored, defensively", () => {
    expect(readNudgeState(null)).toEqual({ visits: 0 });
    expect(readNudgeState("not json")).toEqual({ visits: 0 });
    expect(readNudgeState('{"visits":4,"dismissedAt":123}')).toEqual({ visits: 4, dismissedAt: 123 });
    expect(readNudgeState('{"visits":"x"}')).toEqual({ visits: 0 });
  });
});
