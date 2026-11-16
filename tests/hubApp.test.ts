import { describe, expect, it } from "vitest";
import { alwaysOnView, appStatusView, ENV_NAME, isPublicName } from "@/lib/dashboardV3/hubApp";
import { brandLook } from "@/lib/dashboardV3/hubBrand";

describe("app status", () => {
  const base = { kind: "server" as const, isLive: true, building: false };
  it("says running, building, needs attention and not online in plain words", () => {
    expect(appStatusView(base).state).toBe("running");
    expect(appStatusView({ ...base, building: true }).body).toMatch(/current version stays online/);
    expect(appStatusView({ ...base, buildFailed: "Missing file" })).toMatchObject({ state: "attention" });
    expect(appStatusView({ ...base, buildFailed: "" }).body).toMatch(/previous version is still online/);
    expect(appStatusView({ ...base, gitError: "No package.json." }).body).toMatch(/GitHub didn't go live/);
    expect(appStatusView({ ...base, isLive: false }).state).toBe("idle");
  });
});

describe("always on", () => {
  it("offers the right action for each state", () => {
    expect(alwaysOnView({ request: "NONE", status: "OFF", error: null }).action).toBe("request");
    expect(alwaysOnView({ request: "REQUESTED", status: "OFF", error: null }).action).toBeNull();
    expect(alwaysOnView({ request: "APPROVED", status: "ON", error: null }).action).toBe("turn-off");
    expect(alwaysOnView({ request: "APPROVED", status: "ON", error: null }, true).action).toBeNull();
  });
});

describe("settings names", () => {
  it("accepts API_KEY style names and spots ones visitors can read", () => {
    expect(ENV_NAME.test("STRIPE_KEY")).toBe(true);
    expect(ENV_NAME.test("stripe key")).toBe(false);
    expect(isPublicName("NEXT_PUBLIC_API")).toBe(true);
    expect(isPublicName("SECRET_KEY")).toBe(false);
  });
});

describe("brand look", () => {
  it("reads colours and fonts from the hosted sheet", () => {
    const look = brandLook(":root{--color-action-primary-bg:#1F6F4A;--color-bg-canvas:#fbf7ef;--font-family-heading:'Playfair Display', serif;--font-family-body:Inter, sans-serif;}");
    expect(look.colors.map((c) => c.value)).toEqual(["#1F6F4A", "#fbf7ef"]);
    expect(look.fonts).toEqual([{ label: "Headings", family: "Playfair Display" }, { label: "Text", family: "Inter" }]);
  });
  it("copes with an empty sheet", () => expect(brandLook("/* no brand linked */")).toEqual({ colors: [], fonts: [] }));
});
