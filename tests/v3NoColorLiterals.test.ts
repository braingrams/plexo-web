import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// v3 components take every colour from tokens (lib/brandTokens.ts) so a Strata publish can
// restyle the app. Hex, rgb()/rgba() and hsl() literals are not allowed in the v3 folders.
const ROOT = join(__dirname, "..");
const DIRS = ["app/dashboard/_v3"];
// Generated logo path data is numbers only, but skip it explicitly for clarity.
const SKIP = new Set(["app/dashboard/_v3/brand/logoPaths.ts"]);
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}

describe("v3 has no colour literals", () => {
  for (const dir of DIRS) {
    it(dir, () => {
      const offenders: string[] = [];
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (SKIP.has(rel)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, "");
            if (LITERAL.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }
});
