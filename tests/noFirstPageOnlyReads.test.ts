import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// DynamoDB returns at most 1 MB per query. ElectroDB's `.go()` with no options returns
// only that first page — a migrated blog's 541 posts showed as 34, and a busy store's
// orders list would silently stop after a few hundred. In these areas every list read
// must pass `{ pages: "all" }` (or an explicit `limit`/`cursor` when it pages on purpose).
const AREAS = [
  "app/dashboard/**/*.{ts,tsx}",
  "app/api/blog/**/*.ts",
  "app/api/v1/commerce/**/*.ts",
  "app/api/public/commerce/**/*.ts",
  "app/api/v1/templates/**/*.ts",
  "app/pub/**/*.{ts,tsx}",
  "lib/blog/**/*.ts",
  "lib/blogImport/**/*.ts",
  "lib/commerce/**/*.ts",
  "lib/forms/**/*.ts",
  "lib/sites/**/*.ts",
  "lib/wpMigration/**/*.ts",
  "lib/mcp/blogTools.ts",
  "lib/mcp/commerceTools.ts",
  "lib/mcp/formTools.ts",
];
const FIRST_PAGE_ONLY = /\.query\s*\.\s*[a-zA-Z]+\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\.go\(\)/g;

describe("list reads in blog, Commerce, sites and migration code read every page", () => {
  it("no `.query.x(...).go()` without options", () => {
    const offenders: string[] = [];
    const files = AREAS.flatMap((g) => globSync(g));
    expect(files.length).toBeGreaterThan(150); // actually scanning the code, not passing on nothing
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(FIRST_PAGE_ONLY)) {
        offenders.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
