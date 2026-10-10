import { describe, expect, it } from "vitest";
import { appIcon, scaffoldFiles } from "@/lib/projects/scaffold";

// A new app's browser-tab icon is its own (first letter, own colours), not Plexo's generic "P".

describe("a new app's icon", () => {
  it("shows the app's first letter, and the same app always gets the same colours", () => {
    expect(appIcon("telly")).toContain(">T</text>");
    expect(appIcon("1st Ave Dental")).toContain(">1</text>");
    expect(appIcon("  ömer's bakery")).toContain(">Ö</text>");
    expect(appIcon("telly")).toBe(appIcon("Telly"));
  });

  it("gives different apps different colours", () => {
    const colour = (n: string) => appIcon(n).match(/stop-color="(#\w+)"/)![1];
    const names = ["telly", "Bellaskincare", "Kaycare", "Fresh Brew Café", "Bookings", "Shop", "Academy", "Glow Spa"];
    expect(new Set(names.map(colour)).size).toBeGreaterThanOrEqual(5);
  });

  it("is safe and valid whatever the name", () => {
    for (const n of ["<script>", "&&&", "", "   "]) {
      const svg = appIcon(n);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).not.toContain("<script>");
    }
    expect(appIcon("<script>")).toContain(">S</text>");
    expect(appIcon("")).toContain(">A</text>");
  });

  it("is what a new app starts with", () => {
    expect(scaffoldFiles("telly")["public/favicon.svg"]).toBe(appIcon("telly"));
  });
});
