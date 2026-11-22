import { describe, expect, it } from "vitest";
import { costNote, creditsSpent, wordsSoFar } from "@/lib/dashboardV3/solWrite";

describe("solWrite", () => {
  it("works out what was spent", () => {
    expect(creditsSpent(100, 76)).toBe(24);
    expect(creditsSpent(100, 100)).toBeNull();
    expect(creditsSpent(null, 5)).toBeNull();
  });
  it("describes progress in words", () => {
    expect(wordsSoFar(10)).toBe("just getting started");
    expect(wordsSoFar(1600)).toBe("about 320 words so far");
  });
  it("explains the cost", () => {
    expect(costNote({ paidBy: "own-key", enough: true, estimatedCredits: null, balance: null }, 5)).toMatch(/own AI key/);
    expect(costNote({ paidBy: "plexo", enough: true, estimatedCredits: 12, balance: 1500 }, null)).toBe("About 12 credits. You have 1,500 left.");
    expect(costNote(null, 40)).toBe("Uses AI credits. You have 40 left.");
    expect(costNote(null, null)).toBe("Uses AI credits.");
  });
});

import { listModeKey, parseListMode } from "@/lib/dashboardV3/listMode";
describe("listMode", () => {
  it("only accepts the two modes", () => {
    expect(parseListMode("grid")).toBe("grid");
    expect(parseListMode("nope")).toBe("list");
    expect(parseListMode(null, "grid")).toBe("grid");
    expect(listModeKey("blog")).toBe("plx:listMode:blog");
  });
});
