import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, EDITOR_THEME, EMAIL_COLORS, SURFACES, TEXT, themeCss } from "@/lib/theme";

// Plexo's own colours live in lib/theme.ts and nowhere else. Change them there and the site, the dashboard, the editor
// and every email follow. This fails the moment a purple is typed straight into a file instead.
const ROOT = path.resolve(__dirname, "..");
const PURPLES = /#(8b5cf6|7c3aed|6d28d9|a78bfa|6b3bf9|5b2be6|c084fc)\b/i;
// Customer-facing defaults and docs examples, not Plexo's own look.
const ALLOWED = [
  "lib/theme.ts",
  "lib/pub/blogTheme.tsx", // a customer blog's default accent
  "lib/mcp/blogTools.ts", // an example value in a tool description
  "app/api/blog/[templateId]/site/route.ts", // an example value in an error message
  "app/api/app-oauth/google/callback/route.ts", // a stand-alone page shown in a popup
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "projects"].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(name) && !name.includes(".generated.")) out.push(full);
  }
  return out;
}

describe("Plexo's theme has one home", () => {
  it("no file outside lib/theme.ts types a brand purple by hand", () => {
    const offenders = ["app", "lib", "components"]
      .flatMap((d) => (statSync(path.join(ROOT, d), { throwIfNoEntry: false }) ? walk(path.join(ROOT, d)) : []))
      .map((f) => path.relative(ROOT, f))
      .filter((f) => !ALLOWED.includes(f) && !f.startsWith("lib/projects/"))
      .filter((f) => PURPLES.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("prints every colour variable for both modes from the constants", () => {
    const css = themeCss();
    expect(css).toContain(`:root.dark{`);
    expect(css).toContain(`:root.light{`);
    expect(css).toContain(`--brand:${BRAND.primary}`);
    expect(css).toContain(`--bg:${SURFACES.bg}`);
    expect(css).toContain(`--text-main:${TEXT.main}`);
    expect(css).toContain("--brand-rgb:139, 92, 246");
  });

  it("the editor and the emails read the same palette", () => {
    expect(EDITOR_THEME).toEqual({ accent: BRAND.primary, background: SURFACES.bg, text: TEXT.main });
    expect(EMAIL_COLORS.brand).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
