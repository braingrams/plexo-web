import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every place the visual editor is mounted must pass every host prop that makes saving and going live work. A mount that
// leaves one out silently gets a worse editor (no Save menu entry, no Autosave choice, no web-address question), so this
// fails the build instead.
const REQUIRED = ["onSave", "onSaveDraft", "onPublish", "hasAddress", "autosavePreference", "onAskSolManyPages"];
// Mounts that deliberately keep nothing (a compile-only demo): they have no page to save or put live.
const NO_PAGE_TO_SAVE = new Set(["app/dashboard/sdk/v2-playground.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("every editor mount passes the host props", () => {
  const files = ["app", "lib"].flatMap((d) => walk(d)).filter((f) => /<(V2Editor|Editor)\b/.test(readFileSync(f, "utf8")) && /plexo-sdk\/v2/.test(readFileSync(f, "utf8")));
  it("finds the known mounts", () => {
    expect(files.some((f) => f.endsWith("V2TemplateEditor.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("DesignPane.tsx"))).toBe(true);
  });
  for (const file of files.filter((f) => !NO_PAGE_TO_SAVE.has(f))) {
    it(`${file} passes ${REQUIRED.join(", ")}`, () => {
      const src = readFileSync(file, "utf8");
      const mount = src.slice(src.search(/<(V2Editor|Editor)\b/));
      for (const prop of REQUIRED) expect(mount, `${file} is missing ${prop}`).toMatch(new RegExp(`\\b${prop}=`));
    });
  }
});

describe("old top-bar wording is gone", () => {
  it("has no 'Make it live' or 'Keeping your changes safe' in the app, library or docs", () => {
    const hits: string[] = [];
    for (const dir of ["app", "lib", "docs"]) {
      let list: string[] = [];
      try { list = walkAll(dir); } catch { continue; }
      for (const f of list) if (/make it live|keeping your changes safe/i.test(readFileSync(f, "utf8"))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

function walkAll(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else if (/\.(tsx?|md|mdx|json)$/.test(p)) out.push(p);
  }
  return out;
}
