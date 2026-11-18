import { beforeEach, describe, expect, it, vi } from "vitest";

const adds: { date: string; dimension: string; n: number }[] = [];
let fail = false;
vi.mock("@/lib/db/opsEntities", () => ({
  ExperienceDailyStat: {
    update: ({ date, dimension }: { date: string; dimension: string }) => ({
      add: ({ count }: { count: number }) => ({
        go: async () => {
          if (fail) throw new Error("dynamo down");
          adds.push({ date, dimension, n: count });
        },
      }),
    }),
  },
}));

import { modeOf, recordExperienceEvent } from "@/lib/experienceStats";

beforeEach(() => { adds.length = 0; fail = false; });
const at = new Date("2026-11-18T10:00:00Z");

describe("experience stats", () => {
  it("beginner is the simple view; intermediate and pro are the full one", () => {
    expect(modeOf("beginner")).toBe("simple");
    expect(modeOf("intermediate")).toBe("full");
    expect(modeOf("pro")).toBe("full");
  });
  it("counts an open, and one row per person per day for distinct counts", async () => {
    await recordExperienceEvent({ type: "open", mode: "simple", userId: "u1" }, at);
    expect(adds.map((a) => a.dimension)).toEqual(["OPEN#simple", "ACTIVE#simple#u1"]);
    expect(adds.every((a) => a.date === "2026-11-18" && a.n === 1)).toBe(true);
  });
  it("counts a publish and a switch", async () => {
    await recordExperienceEvent({ type: "publish", mode: "full", userId: "u2" }, at);
    await recordExperienceEvent({ type: "switch", from: "simple", to: "full" }, at);
    expect(adds.map((a) => a.dimension)).toEqual(["PUBLISH#full", "SWITCH#simple>full"]);
  });
  it("never throws, so counting can't break the editor", async () => {
    fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(recordExperienceEvent({ type: "open", mode: "full", userId: "u3" }, at)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
