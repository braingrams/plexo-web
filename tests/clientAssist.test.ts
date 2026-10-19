import { afterEach, describe, expect, it, vi } from "vitest";
import { askSolStreaming } from "@/lib/ai/clientAssist";

afterEach(() => vi.unstubAllGlobals());

const ndjson = (lines: string[], split = 7) => {
  const bytes = new TextEncoder().encode(lines.join("\n") + "\n");
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += split) c.enqueue(bytes.slice(i, i + split)); c.close(); } }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
};
const req = { question: "q", context: {} };

describe("askSolStreaming", () => {
  it("hands the whole reply so far to onText as it grows, even when frames are split across chunks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([JSON.stringify({ type: "token", text: "Hello " }), JSON.stringify({ type: "token", text: "there" }), JSON.stringify({ type: "done" })])));
    const seen: string[] = [];
    expect(await askSolStreaming(req, (t) => seen.push(t))).toBe("Hello there");
    expect(seen).toEqual(["Hello ", "Hello there"]);
  });

  it("returns the server's plain-English reason for a refusal (402)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "You don't have enough AI credits for this." }, { status: 402 })));
    expect(await askSolStreaming(req, () => {})).toBe("You don't have enough AI credits for this.");
  });

  it("an error frame after some words keeps the words and adds the reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([JSON.stringify({ type: "token", text: "Partly" }), JSON.stringify({ type: "error", error: "SOL couldn't answer that: busy." })])));
    expect(await askSolStreaming(req, () => {})).toBe("Partly\n\nSOL couldn't answer that: busy.");
  });

  it("offline reads as a connection problem, a stopped request rethrows so the panel can say Stopped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await askSolStreaming(req, () => {})).toMatch(/couldn't reach Plexo/);
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(askSolStreaming(req, () => {}, ac.signal)).rejects.toThrow();
  });

  it("ignores keep-alive frames", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([JSON.stringify({ type: "token", text: "" }), JSON.stringify({ type: "token", text: "ok" }), JSON.stringify({ type: "done" })])));
    const seen: string[] = [];
    await askSolStreaming(req, (t) => seen.push(t));
    expect(seen).toEqual(["ok"]);
  });
});
