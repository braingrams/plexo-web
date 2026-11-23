import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brandTokensCss } from "@/lib/brandTokens";

/**
 * A customer's page is drawn inside the dashboard while they edit it. Plexo's own styles must never reach it: the page was
 * showing Plexo-lime buttons and floating dropdown panels where its own links should be.
 */
describe("Plexo's styles stay off the customer's page in the editor", () => {
  it("clears every dashboard colour/font/shape token inside the editor canvas", () => {
    const css = brandTokensCss();
    const reset = css.split("\n").find((l) => l.startsWith("[data-plx-canvas]{"));
    expect(reset).toBeTruthy();
    // Plexo's same-named tokens (a customer's design system uses Strata's names too).
    expect(reset).toContain("--color-action-primary-bg:initial;");
    expect(reset).toContain("--plx-accent:initial;");
    expect(reset).toContain("--plx-radius:initial;");
  });

  // Class names the editor's page also uses (plx-btn, plx-menu, plx-field, plx-form, plx-check, plx-page, ...).
  const SHARED = /\.plx-(btn|menu|field|form|check|page|body|empty|next|prev|track)(?![\w-])/g;
  const GUARD = ":where(:not([data-plx-canvas] *))";

  it("every dashboard rule for a class the customer's page also uses skips the canvas", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith(".css")) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "app"));
    const unguarded: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/([^{}]+)\{/g)) {
        const selector = m[1].trim();
        if (selector.startsWith("@") || /^[\d.%\s,]+$|^(from|to)\b/.test(selector)) continue;
        for (const hit of selector.matchAll(SHARED)) {
          const after = selector.slice((hit.index ?? 0) + hit[0].length);
          if (!after.startsWith(GUARD)) unguarded.push(`${path.relative(process.cwd(), file)}: ${selector.slice(0, 90)}`);
        }
      }
    }
    expect(unguarded, "These rules would restyle the customer's page in the editor. Add :where(:not([data-plx-canvas] *)) after the class, or rename it.").toEqual([]);
  });
});
