import { describe, it, expect } from "vitest";
import { parseLiveBuildMessage, buildLogChannelName, MAX_LOG_LINE_CHARS } from "@/lib/realtime/buildLog";

const buildId = "6daa8824-a97b-42e0-a47e-71f665f39aeb";
const templateId = "04e566d7-3789-49bf-95f5-c39fd6f310cf";

describe("parseLiveBuildMessage", () => {
  it("reads a log batch", () => {
    expect(parseLiveBuildMessage(JSON.stringify({ type: "build-log", buildId, templateId, seq: 3, lines: ["a", "b"] })))
      .toEqual({ type: "build-log", buildId, templateId, seq: 3, lines: ["a", "b"] });
  });

  it("reads a final status", () => {
    expect(parseLiveBuildMessage(JSON.stringify({ type: "build-status", buildId, templateId, status: "FAILED", summary: "2 errors" })))
      .toMatchObject({ type: "build-status", status: "FAILED" });
  });

  it("ignores the other messages on the events queue", () => {
    expect(parseLiveBuildMessage(JSON.stringify({ buildId }))).toBeNull();
    expect(parseLiveBuildMessage(JSON.stringify({ kind: "publish", templateId }))).toBeNull();
  });

  it("rejects malformed live messages", () => {
    expect(parseLiveBuildMessage(JSON.stringify({ type: "build-log", buildId, templateId, seq: "3", lines: [] }))).toBeNull();
    expect(parseLiveBuildMessage(JSON.stringify({ type: "build-log", buildId, templateId, seq: 1, lines: [1] }))).toBeNull();
    expect(parseLiveBuildMessage(JSON.stringify({ type: "build-status", buildId, templateId, status: "RUNNING", summary: "" }))).toBeNull();
    expect(parseLiveBuildMessage("not json")).toBeNull();
  });
});

describe("buildLogChannelName", () => {
  it("is a private channel per build", () => {
    expect(buildLogChannelName(buildId)).toBe(`private-build-${buildId}`);
  });
});

describe("line limit", () => {
  it("keeps a single line under the per-event limit", () => {
    expect(MAX_LOG_LINE_CHARS).toBeLessThanOrEqual(2000);
  });
});
