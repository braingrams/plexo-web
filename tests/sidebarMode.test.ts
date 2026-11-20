import { describe, expect, it } from "vitest";
import { foldedFromStorage, shellFrameFor } from "@/lib/dashboardV3/sidebarMode";

describe("shellFrameFor", () => {
  it("keeps the menu (folded) around the page editor", () => {
    expect(shellFrameFor("/dashboard/templates/abc")).toBe("editor");
    expect(shellFrameFor("/dashboard/templates/abc/")).toBe("editor");
  });
  it("leaves app editors chromeless and everything else full", () => {
    expect(shellFrameFor("/dashboard/apps/x")).toBe("none");
    expect(shellFrameFor("/dashboard/templates/upload")).toBe("full");
    expect(shellFrameFor("/dashboard/templates/abc/sections")).toBe("full");
    expect(shellFrameFor("/dashboard")).toBe("full");
  });
});

describe("foldedFromStorage", () => {
  it("starts folded in the editor, remembers a choice, and leaves other pages to their default", () => {
    expect(foldedFromStorage("editor", null)).toBe(true);
    expect(foldedFromStorage("editor", "0")).toBe(false);
    expect(foldedFromStorage("full", null)).toBeNull();
    expect(foldedFromStorage("full", "1")).toBe(true);
  });
});
