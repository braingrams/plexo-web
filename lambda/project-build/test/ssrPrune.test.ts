import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
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
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("removes Vite, Rolldown and LightningCSS, and keeps what the server needs", () => {
    expect(pruneBuildOnlyPackages(dir)).toEqual(["@rolldown", "lightningcss", "lightningcss-linux-x64-gnu", "vite"]);
    for (const kept of ["astro", "@img", "@shikijs", "@aws-sdk"]) expect(existsSync(join(dir, kept))).toBe(true);
    for (const gone of ["vite", "@rolldown", "lightningcss", "lightningcss-linux-x64-gnu"]) expect(existsSync(join(dir, gone))).toBe(false);
  });

  it("does nothing when node_modules is missing", () => {
    expect(pruneBuildOnlyPackages(join(dir, "missing"))).toEqual([]);
  });
});
