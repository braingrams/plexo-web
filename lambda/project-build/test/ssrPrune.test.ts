import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pruneBuildOnlyPackages } from "../src/ssrPrune";

describe("pruneBuildOnlyPackages", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-"));
    for (const name of ["astro", "vite", "@rolldown", "lightningcss", "lightningcss-linux-x64-gnu", "@img", "@shikijs", "@aws-sdk"]) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, "index.js"), "// placeholder");
    }
    // Binary links, as npm creates them: one to a package we remove, one to a package we keep.
    mkdirSync(join(dir, ".bin"));
    symlinkSync("../vite/bin/vite.js", join(dir, ".bin", "vite"));
    mkdirSync(join(dir, "astro", "bin"));
    writeFileSync(join(dir, "astro", "bin", "astro.js"), "// placeholder");
    symlinkSync("../astro/bin/astro.js", join(dir, ".bin", "astro"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("removes Vite, Rolldown and LightningCSS, and keeps what the server needs", () => {
    expect(pruneBuildOnlyPackages(dir)).toEqual(["@rolldown", "lightningcss", "lightningcss-linux-x64-gnu", "vite"]);
    for (const kept of ["astro", "@img", "@shikijs", "@aws-sdk"]) expect(existsSync(join(dir, kept))).toBe(true);
    for (const gone of ["vite", "@rolldown", "lightningcss", "lightningcss-linux-x64-gnu"]) expect(existsSync(join(dir, gone))).toBe(false);
  });

  it("removes .bin links that now point at nothing, and keeps the rest", () => {
    pruneBuildOnlyPackages(dir);
    // The astro link still points at a real file, so it stays.
    expect(lstatSync(join(dir, ".bin", "astro")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, ".bin", "astro"))).toBe(true);
    // The vite link pointed at the removed package, so it is gone.
    expect(() => lstatSync(join(dir, ".bin", "vite"))).toThrow();
  });

  it("does nothing when node_modules is missing", () => {
    expect(pruneBuildOnlyPackages(join(dir, "missing"))).toEqual([]);
  });
});
