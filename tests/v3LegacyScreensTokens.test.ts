import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Shared per-site and settings screens render for old-dashboard users (dark only) and new-dashboard users
// (light or dark, brand tokens). Their text and surface colours must therefore be `var(--plx-x, <old value>)`,
// never the bare dark-theme literal, or they turn unreadable in light mode.
const ROOT = join(__dirname, "..");
const DIRS = ["app/dashboard/templates/[id]", "app/dashboard/settings", "app/dashboard/_components"];
const SKIP = new Set(["template-editor-client.tsx", "template-editor-dynamic.tsx", "raw-file-editor.tsx", "RawAiEditPanel.tsx", "RawTextContentEditor.tsx", "TrafficChart.tsx", "ActivityHeatmap.tsx", "Avatar.tsx"]);
const BARE_DARK_TEXT = /(?<!var\(--plx-[a-z-]+, )(?<!rgb\()(#f0f2ff|#e2e4f5|#c5cbe8|rgba\(\s*240\s*,\s*242\s*,\s*255)/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "v2" ? [] : files(p);
    return /\.tsx$/.test(name) && !SKIP.has(name) ? [p] : [];
  });
}

describe("shared screens use brand tokens with the old look as the fallback", () => {
  for (const dir of DIRS) {
    it(dir, () => {
      const offenders: string[] = [];
      for (const file of files(join(ROOT, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, "");
            // A bare light-on-dark literal; the only allowed spot is the fallback inside var(--plx-…, …) or color-mix(… var(--plx-text, …)).
            const stripped = code.replace(/var\(--plx-[a-z-]+,\s*[^)]*\)?\)/g, "").replace(/color-mix\([^)]*\)/g, "");
            if (BARE_DARK_TEXT.test(stripped)) offenders.push(`${relative(ROOT, file)}:${i + 1}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }
});
