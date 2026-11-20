import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The NEW dashboard (v2/v3: app/dashboard/_v3, lib/dashboardV3, app/v3-preview) has no purple. Plexo is lime and deep green.
const ROOT = path.resolve(__dirname, "..");
const PURPLE = /#(8b5cf6|7c3aed|6d28d9|a78bfa|6366f1|4f46e5|c4b5fd|818cf8|8a7bff|5545d6|a99fff|c084fc)\b|\b(purple|violet|indigo)-\d{2,3}\b/i;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(tsx?|css)$/.test(n)) out.push(f);
  }
  return out;
};

describe("the new dashboard has no purple", () => {
  it("no purple hex or Tailwind purple class in the new dashboard's files", () => {
    const bad = ["app/dashboard/_v3", "lib/dashboardV3", "app/v3-preview"]
      .filter((d) => statSync(path.join(ROOT, d), { throwIfNoEntry: false }))
      .flatMap((d) => walk(path.join(ROOT, d)))
      .filter((f) => PURPLE.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it("re-points the violet and info tokens to non-purple brand tokens inside the new dashboard", () => {
    const css = readFileSync(path.join(ROOT, "app/dashboard/_v3/v3.css"), "utf8");
    expect(css).toMatch(/html \[data-plexo-v3\]\s*\{[^}]*--plx-violet:\s*var\(--plx-accent\)[^}]*--plx-info:\s*var\(--plx-success\)/);
  });
});
