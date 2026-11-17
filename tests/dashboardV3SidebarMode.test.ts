import { describe, expect, it } from "vitest";
import { parseSidebarChoice, sidebarModeForPath, sidebarViewFor } from "@/lib/dashboardV3/sidebarMode";

describe("sidebarModeForPath", () => {
  it("uses the conversations column inside SOL, and only there", () => {
    expect(sidebarModeForPath("/dashboard/sol")).toBe("sol");
    expect(sidebarModeForPath("/dashboard/sol/abc123")).toBe("sol");
    expect(sidebarModeForPath("/dashboard/sol/settings")).toBe("sol");
    expect(sidebarModeForPath("/dashboard/sol/memory")).toBe("sol");
    expect(sidebarModeForPath("/v3-preview/sol")).toBe("sol");
    expect(sidebarModeForPath("/dashboard/sol?new=1")).toBe("sol");
  });
  it("keeps the normal menu everywhere else", () => {
    expect(sidebarModeForPath("/dashboard")).toBe("menu");
    expect(sidebarModeForPath("/dashboard/settings")).toBe("menu");
    expect(sidebarModeForPath("/dashboard/solutions")).toBe("menu");
    expect(sidebarModeForPath("/v3-preview/home")).toBe("menu");
    expect(sidebarModeForPath(null)).toBe("menu");
  });
});

describe("sidebarViewFor", () => {
  it("defaults to Chats inside SOL and honours the choice", () => {
    expect(sidebarViewFor("sol", null)).toBe("chats");
    expect(sidebarViewFor("sol", "chats")).toBe("chats");
    expect(sidebarViewFor("sol", "menu")).toBe("menu");
  });
  it("always shows the menu outside SOL", () => {
    expect(sidebarViewFor("menu", "chats")).toBe("menu");
  });
  it("ignores junk in storage", () => {
    expect(parseSidebarChoice("chats")).toBe("chats");
    expect(parseSidebarChoice("x")).toBeNull();
  });
});
