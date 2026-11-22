import { describe, expect, it } from "vitest";
import { SHORTCUTS, formatShortcut, looksLikeMac } from "@/lib/editorModes/shortcuts";

describe("shortcuts", () => {
  it("shows the right modifier key", () => {
    expect(formatShortcut("Mod+Shift+Z", true)).toBe("⌘ Shift Z");
    expect(formatShortcut("Mod+Shift+Z", false)).toBe("Ctrl Shift Z");
    expect(formatShortcut("Tab", false)).toBe("Tab");
  });
  it("recognises Apple computers", () => {
    expect(looksLikeMac("MacIntel")).toBe(true);
    expect(looksLikeMac("iPhone")).toBe(true);
    expect(looksLikeMac("Win32")).toBe(false);
    expect(looksLikeMac(undefined)).toBe(false);
  });
  it("describes every shortcut in plain words", () => {
    for (const s of SHORTCUTS) {
      expect(s.does.length).toBeGreaterThan(3);
      expect(s.does).not.toMatch(/\b(DOM|syntax|toggle|markup)\b/i);
    }
    expect(new Set(SHORTCUTS.map((s) => s.keys)).size).toBe(SHORTCUTS.length);
  });
});
