import { describe, it, expect, vi } from "vitest";
import { createLogStreamer } from "../src/logStreamer";

describe("createLogStreamer", () => {
  it("sends complete lines in order, one batch per flush", async () => {
    const sent: { seq: number; lines: string[] }[] = [];
    const streamer = createLogStreamer(async (b) => void sent.push(b), { flushMs: 10_000, maxBytes: 100_000 });
    streamer.push("one\ntwo\n");
    streamer.push("three\n");
    await streamer.close();
    expect(sent).toEqual([{ seq: 0, lines: ["one", "two", "three"] }]);
  });

  it("holds a partial line until its newline arrives", async () => {
    const sent: string[][] = [];
    const streamer = createLogStreamer(async (b) => void sent.push(b.lines), { flushMs: 10_000, maxBytes: 100_000 });
    streamer.push("hel");
    streamer.push("lo\nwor");
    await streamer.close();
    expect(sent).toEqual([["hello", "wor"]]);
  });

  it("flushes as soon as the waiting text reaches maxBytes", async () => {
    const sent: { seq: number; lines: string[] }[] = [];
    const streamer = createLogStreamer(async (b) => void sent.push(b), { flushMs: 10_000, maxBytes: 10 });
    streamer.push("aaaaaaaaa\n");
    streamer.push("bbbbbbbbb\n");
    await streamer.close();
    expect(sent.map((b) => b.seq)).toEqual([0, 1]);
    expect(sent.flatMap((b) => b.lines)).toEqual(["aaaaaaaaa", "bbbbbbbbb"]);
  });

  it("flushes on a timer when output is slow", async () => {
    vi.useFakeTimers();
    try {
      const sent: string[][] = [];
      const streamer = createLogStreamer(async (b) => void sent.push(b.lines), { flushMs: 700, maxBytes: 100_000 });
      streamer.push("slow\n");
      expect(sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(700);
      expect(sent).toEqual([["slow"]]);
      await streamer.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sending after one batch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: string[] = [];
    let calls = 0;
    const streamer = createLogStreamer(async (b) => {
      calls += 1;
      if (calls === 1) throw new Error("queue unavailable");
      sent.push(...b.lines);
    }, { flushMs: 10_000, maxBytes: 5 });
    streamer.push("first\n");
    streamer.push("second\n");
    await streamer.close();
    expect(sent).toEqual(["second"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
