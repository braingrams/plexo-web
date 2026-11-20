import { describe, expect, it } from "vitest";
import { AUTOSAVE_KEY, readAutosave, saveStatus, savedAgo, writeAutosave } from "@/lib/editor/saveModel";

const mem = (init: Record<string, string> = {}) => {
  const d = { ...init };
  return { getItem: (k: string) => d[k] ?? null, setItem: (k: string, v: string) => void (d[k] = v), d };
};

describe("autosave preference", () => {
  it("is on by default", () => expect(readAutosave(mem())).toBe(true));
  it("remembers the owner's choice for every page", () => {
    const s = mem();
    writeAutosave(s, false);
    expect(s.d[AUTOSAVE_KEY]).toBe("false");
    expect(readAutosave(s, "any-page")).toBe(false);
  });
  it("still honours an older per-page choice until a new one is made", () => {
    expect(readAutosave(mem({ "autosave-p1": "false" }), "p1")).toBe(false);
    expect(readAutosave(mem({ "autosave-p1": "false", [AUTOSAVE_KEY]: "true" }), "p1")).toBe(true);
  });
  it("never throws when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(readAutosave(blocked)).toBe(true);
    expect(() => writeAutosave(blocked, true)).not.toThrow();
  });
});

describe("savedAgo", () => {
  const now = 1_000_000_000;
  it("speaks in plain words", () => {
    expect(savedAgo(now - 5_000, now)).toBe("just now");
    expect(savedAgo(now - 120_000, now)).toBe("2 min ago");
    expect(savedAgo(now - 3 * 3600_000, now)).toBe("3 hours ago");
    expect(savedAgo(now - 30 * 3600_000, now)).toBe("yesterday");
    expect(savedAgo(null, now)).toBe("");
  });
});

describe("saveStatus", () => {
  const base = { saving: false, error: null, dirty: false, autosave: true, savedAt: null };
  it("prioritises saving, then errors, then unsaved, then saved", () => {
    expect(saveStatus({ ...base, saving: true, error: "x", dirty: true }).tone).toBe("saving");
    expect(saveStatus({ ...base, error: "x", dirty: true }).tone).toBe("error");
    expect(saveStatus({ ...base, dirty: true }).text).toBe("Saving soon…");
    expect(saveStatus({ ...base, dirty: true, autosave: false }).text).toBe("Unsaved changes");
    expect(saveStatus({ ...base, savedAt: 1000, now: 121_000 }).text).toBe("Saved 2 min ago");
    expect(saveStatus({ ...base, autosave: false }).text).toBe("Autosave is off");
  });
});
