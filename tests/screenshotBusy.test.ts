import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_BUSY_MESSAGE, _openSessionForTests as openSession } from "@/lib/projects/screenshot";

// Browserbase answers 429 while all the account's browsers are in use. Plexo used to give up
// at once ("Couldn't open a browser… (429)") and SOL kept retrying, burning credits.

const busy = () => new Response("busy", { status: 429 });
const ok = () => new Response(JSON.stringify({ id: "s1", connectUrl: "wss://x" }), { status: 200 });
const noWait = async () => {};

afterEach(() => vi.unstubAllGlobals());

describe("opening a browser when the service is busy", () => {
  it("waits and tries again", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    await expect(openSession("key", noWait)).resolves.toEqual({ id: "s1", connectUrl: "wss://x" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up with a plain message that tells SOL not to retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => busy()));
    await expect(openSession("key", noWait)).rejects.toThrow(BROWSER_BUSY_MESSAGE);
  });

  it("doesn't retry other failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(openSession("key", noWait)).rejects.toThrow("(401)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
