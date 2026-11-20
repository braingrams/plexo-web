import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owners see "brand", never the tool behind it. "Strata" may appear only in the help panel (BrandHelp.tsx), the help text
 * (HELP_COPY in lib/dashboardV3/brandDefinition.ts), and developer-facing places (code, logs, comments, MCP tools).
 */
const ROOTS = ["app/dashboard/_v3", "app/dashboard/templates/[id]/detail", "app/welcome", "app/auth", "lib/dashboardV3", "lib/brand", "lib/strata", "lib/sites", "lib/strataConnect.ts"];
const ALLOWED_FILES = ["app/dashboard/_v3/hub/BrandHelp.tsx"];
// lib/brand/brandModel.ts also holds the prompts written for SOL and AI helpers (not shown to owners): those lines are exempt by file below.
const EXEMPT_FILES = ["lib/brand/brandModel.ts"];
const INTERNAL_LINE = /console\.|Strata (did not publish|was slow to answer|answered)|No Strata session|Brand for this site, from Strata|next: "|v3-preview/;

function files(path: string): string[] {
  const st = statSync(path);
  if (!st.isDirectory()) return /\.(ts|tsx)$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((n) => files(join(path, n)));
}

function ownerStrings(src: string): string[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const out: string[] = [];
  noBlock.split("\n").forEach((line, i) => {
    const code = line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/\s.*$/, "");
    if (!/\bStrata\b/.test(code) || /^\s*import\b/.test(code) || INTERNAL_LINE.test(code)) return;
    // Only text inside quotes or JSX text counts; identifiers such as StrataError are not "Strata" words.
    if (/["'`][^"'`]*\bStrata\b[^"'`]*["'`]|>[^<>{}]*\bStrata\b[^<>{}]*</.test(code)) out.push(`${i + 1}: ${code.trim().slice(0, 140)}`);
  });
  return out;
}

describe("owner-facing text never says Strata outside the help", () => {
  const all = ROOTS.flatMap((r) => files(r)).filter((f) => !ALLOWED_FILES.includes(f) && !EXEMPT_FILES.includes(f) && f !== "lib/dashboardV3/brandDefinition.ts");
  it("scans real files", () => expect(all.length).toBeGreaterThan(30));
  for (const f of all) {
    it(f, () => expect(ownerStrings(readFileSync(f, "utf8"))).toEqual([]));
  }
  it("the SOL prompt offers 'saved brands', not the tool's name", () => {
    expect(readFileSync("lib/ai/solDiscovery.ts", "utf8")).not.toMatch(/ask_user_question \("Use one of your Strata/);
  });
});

describe("SOL is told to say brand", () => {
  it("both the prompt block and the guide say so", () => {
    expect(readFileSync("lib/brand/brandModel.ts", "utf8")).toMatch(/never \\"Strata\\", unless the owner uses that word first/);
    expect(readFileSync("lib/ai/solDiscovery.ts", "utf8")).toMatch(/never "Strata", unless the owner uses that word first/);
  });
});
