import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrataError } from "@charisol/plexo-sdk/v2/strata";
import { createStrataAdapter, type StrataAdapterWindow } from "@/app/dashboard/apps/_components/strataAdapter";
import { finishStrataConnect, markStrataConnect, readStrataPopupMessage, takeStrataConnect, STRATA_CONNECT_KEY } from "@/lib/strataConnect";

// The editor-side Strata adapter (popup sign-in + calls to Plexo's /api/v1/strata routes) and the
// small contract shared with the popup's callback page.

const ORIGIN = "https://plexo.test";

function fakeWindow() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const popup = { closed: false, close: vi.fn(() => void (popup.closed = true)) };
  const win = {
    location: { origin: ORIGIN },
    screenX: 100,
    screenY: 50,
    outerWidth: 1480,
    outerHeight: 900,
    open: vi.fn((): typeof popup | null => popup),
    addEventListener: (_: "message", l: (e: MessageEvent) => void) => void listeners.add(l),
    removeEventListener: (_: "message", l: (e: MessageEvent) => void) => void listeners.delete(l),
  };
  const send = (data: unknown, over: { origin?: string; source?: unknown } = {}) => listeners.forEach((l) => l({ data, origin: over.origin ?? ORIGIN, source: "source" in over ? over.source : popup } as MessageEvent));
  return { win: win as unknown as StrataAdapterWindow, raw: win, popup, send, listenerCount: () => listeners.size };
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let routes: (url: string, init?: RequestInit) => Response;
const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => routes(String(input), init));

beforeEach(() => {
  vi.useFakeTimers();
  fetchFn.mockClear();
  routes = () => reply(200, { available: true, connected: false, expired: false });
});
afterEach(() => vi.useRealTimers());

describe("connect()", () => {
  it("opens a centred popup on the start page and resolves with the status once the popup reports success", async () => {
    const w = fakeWindow();
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    routes = () => reply(200, { available: true, connected: true, expired: false, user: { email: "a@b.c", name: "Ada" } });
    const pending = adapter.connect();
    expect(w.raw.open).toHaveBeenCalledWith(`${ORIGIN}/auth/strata`, "plexo-strata-connect", expect.stringContaining("width=480"));
    expect(w.raw.open.mock.calls[0]).toBeDefined();
    const features = (w.raw.open.mock.calls[0] as unknown as string[])[2];
    expect(features).toContain(`left=${Math.round(100 + (1480 - 480) / 2)}`);
    w.send({ type: "plexo-strata-connected" });
    await expect(pending).resolves.toEqual({ connected: true, expired: false, user: { email: "a@b.c", name: "Ada" } });
    expect(w.listenerCount()).toBe(0);
  });

  it("rejects with the popup's message when connecting fails", async () => {
    const w = fakeWindow();
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    const pending = adapter.connect();
    w.send({ type: "plexo-strata-failed", message: "That Charisol account isn't the one you use for Plexo." });
    await expect(pending).rejects.toMatchObject({ message: "That Charisol account isn't the one you use for Plexo.", kind: "invalid" });
    expect(w.listenerCount()).toBe(0);
  });

  it("explains a blocked popup", async () => {
    const w = fakeWindow();
    w.raw.open.mockReturnValue(null);
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    await expect(adapter.connect()).rejects.toThrow("Your browser blocked the sign-in window. Allow pop-ups for Plexo and try again.");
  });

  it("rejects with a friendly message when the popup is closed first", async () => {
    const w = fakeWindow();
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    const pending = adapter.connect();
    const assertion = expect(pending).rejects.toMatchObject({ message: expect.stringMatching(/closed before Strata was connected/), kind: "invalid" });
    w.popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("still succeeds when the popup closes without a message but the connection went through", async () => {
    const w = fakeWindow();
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    routes = () => reply(200, { available: true, connected: true, expired: false });
    const pending = adapter.connect();
    w.popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({ connected: true });
  });

  it("ignores messages from other origins, other windows, or with other shapes", async () => {
    const w = fakeWindow();
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    const pending = adapter.connect();
    let settled = false;
    void pending.then(() => (settled = true), () => (settled = true));
    w.send({ type: "plexo-strata-connected" }, { origin: "https://evil.test" });
    w.send({ type: "plexo-strata-connected" }, { source: {} });
    w.send({ type: "something-else" });
    w.send("plexo-strata-connected");
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    w.send({ type: "plexo-strata-failed" });
    await expect(pending).rejects.toBeInstanceOf(StrataError);
  });

  it("shares one popup between repeated clicks", () => {
    const w = fakeWindow();
    const adapter = createStrataAdapter({ win: w.win, fetchFn: fetchFn as never });
    const a = adapter.connect();
    const b = adapter.connect();
    expect(a).toBe(b);
    expect(w.raw.open).toHaveBeenCalledTimes(1);
    w.send({ type: "plexo-strata-failed" });
    return a.catch(() => undefined);
  });
});

describe("the data calls", () => {
  const adapter = () => createStrataAdapter({ win: fakeWindow().win, fetchFn: fetchFn as never });

  it("map straight onto the routes", async () => {
    const a = adapter();
    routes = (url, init) => {
      if (url.endsWith("/projects") && init?.method === "POST") return reply(201, { project: { id: "p2", name: "Brand" } });
      if (url.endsWith("/projects")) return reply(200, { projects: [{ id: "p1", name: "Acme" }] });
      if (url.endsWith("/design-system") && init?.method === "PUT") return reply(200, { revision: "r2" });
      if (url.endsWith("/design-system")) return reply(200, { revision: "r1", tokens: [], components: [] });
      return reply(200, { available: true, connected: false, expired: false });
    };
    expect(await a.listProjects()).toEqual([{ id: "p1", name: "Acme" }]);
    expect(await a.createProject({ name: "Brand", template: "base", brandPrimary: "#112233" })).toEqual({ id: "p2", name: "Brand" });
    expect(JSON.parse(String(fetchFn.mock.calls.at(-1)![1]!.body))).toEqual({ name: "Brand", template: "base", brandPrimary: "#112233" });
    expect(await a.pull("p/1")).toEqual({ revision: "r1", tokens: [], components: [] });
    expect(fetchFn.mock.calls.at(-1)![0]).toBe("/api/v1/strata/projects/p%2F1/design-system");
    expect(await a.push("p1", { variables: [], components: [] }, "r1")).toEqual({ revision: "r2" });
    expect(JSON.parse(String(fetchFn.mock.calls.at(-1)![1]!.body))).toEqual({ variables: [], components: [], baseRevision: "r1" });
    await a.disconnect();
    expect(fetchFn.mock.calls.at(-1)![1]!.method).toBe("DELETE");
  });

  it("throw errors the SDK understands, with the server's plain message and kind", async () => {
    const a = adapter();
    routes = () => reply(401, { error: "Your Strata sign-in has run out. Reconnect to keep syncing.", kind: "expired" });
    const err = await a.pull("p1").catch((e) => e);
    expect(err).toBeInstanceOf(StrataError);
    expect(err).toMatchObject({ kind: "expired", message: "Your Strata sign-in has run out. Reconnect to keep syncing." });
    routes = () => reply(429, { error: "That's a lot of requests.", kind: "rate_limited" });
    expect(await a.listProjects().catch((e) => e)).toMatchObject({ kind: "server", message: "That's a lot of requests." });
    routes = () => {
      throw new TypeError("fetch failed");
    };
    expect(await a.listProjects().catch((e) => e)).toMatchObject({ kind: "network" });
  });

  it("reports whether Strata is set up on this Plexo", async () => {
    routes = () => reply(200, { available: false, connected: false, expired: false });
    expect(await adapter().available()).toBe(false);
    routes = () => reply(200, { available: true, connected: true, expired: false, user: { email: "a@b.c" } });
    const a = adapter();
    expect(await a.available()).toBe(true);
    expect(await a.status()).toMatchObject({ connected: true });
  });
});

describe("the popup's hand-back (finishStrataConnect)", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it("posts the ID token to the session route, tells the opener on our origin, and closes", async () => {
    const opener = { postMessage: vi.fn() };
    const close = vi.fn();
    const f = vi.fn(async () => reply(200, { connected: true }));
    expect(await finishStrataConnect({ getIdToken: async () => "id.tok", fetchFn: f as never, opener, origin: ORIGIN, close })).toBe(true);
    expect(f).toHaveBeenCalledWith("/api/v1/strata/session", expect.objectContaining({ method: "POST", body: JSON.stringify({ idToken: "id.tok" }) }));
    expect(opener.postMessage).toHaveBeenCalledWith({ type: "plexo-strata-connected" }, ORIGIN);
    expect(close).toHaveBeenCalled();
  });

  it("reports the server's message on failure, and a missing sign-in", async () => {
    const opener = { postMessage: vi.fn() };
    const failing = vi.fn(async () => reply(403, { error: "Wrong account." }));
    await finishStrataConnect({ getIdToken: async () => "t", fetchFn: failing as never, opener, origin: ORIGIN, close: () => {} });
    expect(opener.postMessage).toHaveBeenLastCalledWith({ type: "plexo-strata-failed", message: "Wrong account." }, ORIGIN);
    await finishStrataConnect({ getIdToken: async () => null, fetchFn: failing as never, opener, origin: ORIGIN, close: () => {} });
    expect(opener.postMessage).toHaveBeenLastCalledWith({ type: "plexo-strata-failed", message: expect.stringMatching(/didn't finish/) }, ORIGIN);
    await finishStrataConnect({ getIdToken: async () => Promise.reject(new Error("expired")), fetchFn: failing as never, opener, origin: ORIGIN, close: () => {} });
    expect(opener.postMessage).toHaveBeenLastCalledWith({ type: "plexo-strata-failed", message: expect.stringMatching(/expired or was already used/) }, ORIGIN);
  });

  it("returns false (and closes nothing) when there is no opener", async () => {
    const close = vi.fn();
    expect(await finishStrataConnect({ getIdToken: async () => null, fetchFn: vi.fn() as never, opener: null, origin: ORIGIN, close })).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("the marker is one-time, and expires", () => {
    const s = store();
    expect(takeStrataConnect(s)).toBe(false);
    markStrataConnect(s, 1000);
    expect(takeStrataConnect(s, 1000 + 60_000)).toBe(true);
    expect(takeStrataConnect(s, 1000 + 60_000)).toBe(false);
    markStrataConnect(s, 1000);
    expect(takeStrataConnect(s, 1000 + 11 * 60_000)).toBe(false);
    expect(s.getItem(STRATA_CONNECT_KEY)).toBeNull();
    s.setItem(STRATA_CONNECT_KEY, "garbage");
    expect(takeStrataConnect(s)).toBe(false);
  });

  it("readStrataPopupMessage only accepts our origin and our two message types", () => {
    expect(readStrataPopupMessage({ origin: ORIGIN, data: { type: "plexo-strata-failed", message: "x" } }, ORIGIN)).toEqual({ type: "plexo-strata-failed", message: "x" });
    expect(readStrataPopupMessage({ origin: "https://evil.test", data: { type: "plexo-strata-connected" } }, ORIGIN)).toBeNull();
    expect(readStrataPopupMessage({ origin: ORIGIN, data: { type: "other" } }, ORIGIN)).toBeNull();
    expect(readStrataPopupMessage({ origin: ORIGIN, data: null }, ORIGIN)).toBeNull();
  });
});
