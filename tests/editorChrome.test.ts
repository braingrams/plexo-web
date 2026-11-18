import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { appBackHref, cssColorToHex, editorBackHref, editorColorsFromTokens, sitesListHref } from "@/lib/dashboardV3/editorChrome";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";

describe("siteHubHref", () => {
  it("opens the hub, optionally on a tab", () => {
    expect(siteHubHref("abc")).toBe("/dashboard/sites/abc");
    expect(siteHubHref("abc", null)).toBe("/dashboard/sites/abc");
    expect(siteHubHref("abc", "orders")).toBe("/dashboard/sites/abc?tab=orders");
  });
});

describe("leaving an editor", () => {
  it("sends new-dashboard owners to the site hub and everyone else to the old pages", () => {
    expect(editorBackHref(true, "s1")).toBe("/dashboard/sites/s1");
    expect(editorBackHref(false, "s1")).toBe("/dashboard/templates/s1/detail");
    expect(sitesListHref(true)).toBe("/dashboard/sites");
    expect(sitesListHref(false)).toBe("/dashboard/templates");
    expect(appBackHref(true, "a1")).toBe("/dashboard/sites/a1");
    expect(appBackHref(true)).toBe("/dashboard/sites");
    expect(appBackHref(false, "a1")).toBe("/dashboard/apps");
  });
});

describe("cssColorToHex", () => {
  it("reads every form Strata allows", () => {
    expect(cssColorToHex("#b8f34a")).toBe("#b8f34a");
    expect(cssColorToHex(" #B8F ")).toBe("#bb88ff");
    expect(cssColorToHex("rgb(184, 243, 74)")).toBe("#b8f34a");
    expect(cssColorToHex("rgba(18 18 18 / 0.5)")).toBe("#121212");
    expect(cssColorToHex("hsl(0, 0%, 100%)")).toBe("#ffffff");
    expect(cssColorToHex("hsl(120 100% 25%)")).toBe("#008000");
  });
  it("gives null for anything it cannot read", () => {
    expect(cssColorToHex("")).toBeNull();
    expect(cssColorToHex(null)).toBeNull();
    expect(cssColorToHex("var(--x)")).toBeNull();
    expect(cssColorToHex("color-mix(in srgb, red, blue)")).toBeNull();
  });
});

describe("editorColorsFromTokens", () => {
  const ok = { brand: "#b8f34a", onBrand: "#121212", bg: "rgb(11, 11, 18)", text: "#f4f5f0", surface: "#15161c" };
  it("turns the live tokens into hex colours for the page editor", () => {
    expect(editorColorsFromTokens(ok)).toEqual({ accent: "#b8f34a", onAccent: "#121212", background: "#0b0b12", text: "#f4f5f0", surface: "#15161c" });
  });
  it("gives up (editor keeps its own look) when any token is unreadable", () => {
    expect(editorColorsFromTokens({ ...ok, bg: "var(--nope)" })).toBeNull();
    expect(editorColorsFromTokens({ ...ok, text: undefined })).toBeNull();
  });
});

// The editors take every colour from the --ed-* / --brand variables so the new dashboard can restyle them from
// Plexo's brand tokens. The old dashboard's palette must only live in editor-theme.css.
const ROOT = join(__dirname, "..");
const BASE = join(ROOT, "app/dashboard");
const DIRS = ["apps", "templates/[id]"];
const SKIP_DIRS = new Set(["detail"]);
// The starting background of a brand-new page is the owner's own site content, not editor chrome.
const CONTENT_EXCEPTIONS = [/templates\/\[id\]\/page\.tsx:\d+: background: "#0b0f19"/];
const OLD_PALETTE = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,|rgba\(\s*240\s*,\s*242\s*,\s*255|rgba\(var\(--brand|#f0f2ff|#6366f1|#f87171|#818cf8|#c4b5fd|#f59e0b|#fbbf24|#34d399|#0b0f19|#0d0f1a|#0a0c15|#11162a|#16142c/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : sources(p);
    return /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}

describe("site editors use Plexo's brand variables", () => {
  const files = DIRS.flatMap((d) => sources(join(BASE, d)));
  it("covers the editors", () => expect(files.length).toBeGreaterThan(40));
  it("has no old-palette colour literals", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const where = `${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`;
        if (OLD_PALETTE.test(line.replace(/\/\/.*$/, "")) && !CONTENT_EXCEPTIONS.some((re) => re.test(where))) offenders.push(where);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("defines every --ed-* variable the editors use, for both dashboards", () => {
    const css = readFileSync(join(BASE, "editor-theme.css"), "utf8");
    const [oldBlock, rest] = css.split("/* New dashboard");
    const used = new Set<string>();
    for (const file of files) for (const m of readFileSync(file, "utf8").matchAll(/var\((--ed-[a-z0-9-]+)\)/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const name of used) {
      if (!new RegExp(`${name}:`).test(oldBlock)) missing.push(`${name} (old dashboard)`);
      if (!new RegExp(`${name}:`).test(rest)) missing.push(`${name} (new dashboard)`);
    }
    expect(missing).toEqual([]);
  });
});
