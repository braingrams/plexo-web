import { describe, expect, it, vi } from "vitest";
import { createSaveGate, saveFailureMessage } from "../lib/editor/saveGate";
import { createAutosavePreference } from "../lib/editor/autosavePref";
import { AUTOSAVE_KEY } from "../lib/editor/saveModel";

const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("save gate", () => {
  it("never runs two saves at once, and a burst of calls becomes one follow-up save", async () => {
    const first = deferred();
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (run.mock.calls.length === 1) await first.promise;
      active--;
    });
    const gate = createSaveGate(run);
    const a = gate.save();
    await tick();
    const b = gate.save();
    const c = gate.save();
    const d = gate.save();
    expect(b).toBe(c);
    expect(c).toBe(d);
    first.resolve();
    await Promise.all([a, b]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it("waits while paused (going live, SOL on several pages) and saves once it is released", async () => {
    const run = vi.fn(async () => undefined);
    const gate = createSaveGate(run);
    gate.setPaused(true);
    const saved = gate.save();
    await tick();
    expect(run).not.toHaveBeenCalled();
    gate.setPaused(false);
    await saved;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failed save does not block the next one", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const gate = createSaveGate(run);
    await expect(gate.save()).rejects.toThrow("offline");
    await expect(gate.save()).resolves.toBeUndefined();
  });
});

describe("save failure wording", () => {
  it("says what happened and what to do", () => {
    expect(saveFailureMessage(null)).toMatch(/offline/);
    expect(saveFailureMessage(401)).toMatch(/signed out/);
    expect(saveFailureMessage(403)).toMatch(/not change/);
    expect(saveFailureMessage(409)).toMatch(/Reload/);
    expect(saveFailureMessage(500, "Boom")).toBe("Boom");
    expect(saveFailureMessage(500)).toMatch(/try again/);
  });
});

describe("autosave preference", () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  it("is on by default, follows the account, and is remembered in the browser", async () => {
    const store = memory();
    const save = vi.fn().mockResolvedValue(undefined);
    expect(createAutosavePreference({ store, save }).get()).toBe(true);
    expect(createAutosavePreference({ store, serverValue: false, save }).get()).toBe(false);
    expect(store.m.get(AUTOSAVE_KEY)).toBe("false");
    await createAutosavePreference({ store, save }).set(true);
    expect(save).toHaveBeenCalledWith(true);
    expect(store.m.get(AUTOSAVE_KEY)).toBe("true");
  });
  it("still remembers the choice here when the account can't be reached", async () => {
    const store = memory();
    await createAutosavePreference({ store, save: () => Promise.reject(new Error("x")) }).set(false);
    expect(store.m.get(AUTOSAVE_KEY)).toBe("false");
  });
});
