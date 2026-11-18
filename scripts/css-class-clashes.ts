/**
 * Finds CSS class names that have rules in two or more DIFFERENT stylesheets.
 *
 * Why: each dashboard section ships its own .css imported only by its own components. On a client-side
 * navigation only some stylesheets are loaded; on a hard reload ALL of them are, so a class reused by two
 * sections silently restyles the other section's elements ("fine after navigating, displaced after reload").
 *
 * Usage: npx tsx scripts/css-class-clashes.ts [--all]   (default: app/dashboard/_v3 only; --all scans app/)
 */
import fs from "node:fs";
import path from "node:path";

export type ClassUse = { file: string; selectors: string[]; props: string[] };
export type Clash = { cls: string; uses: ClassUse[] };

export function walkCss(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkCss(p, out);
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** Extracts { selector, props } rules (flattening @media/@supports/@layer, skipping @keyframes/@font-face). */
export function parseRules(css: string): { selector: string; props: string[] }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selector: string; props: string[] }[] = [];
  let i = 0;
  let prelude = "";
  const skipBlock = () => {
    let depth = 1;
    i++;
    while (i < src.length && depth) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const p = prelude.trim();
      prelude = "";
      if (p.startsWith("@")) {
        if (/^@(media|supports|layer|container|scope)/i.test(p)) { i++; continue; } // descend
        skipBlock(); continue;
      }
      const start = i + 1;
      let depth = 1;
      i++;
      while (i < src.length && depth) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      const body = src.slice(start, i - 1);
      const props = [...body.matchAll(/(?:^|;|\{)\s*(--[\w-]+|[a-zA-Z-]+)\s*:/g)].map((m) => m[1]);
      rules.push({ selector: p, props });
    } else if (ch === "}") { prelude = ""; i++; }
    else if (ch === ";") { prelude = ""; i++; }
    else { prelude += ch; i++; }
  }
  return rules;
}

/** The owning class of a selector part = the FIRST class in it (`[data-x] .a b` -> a). */
function firstClass(part: string): string | null {
  const m = part.match(/\.(-?[_a-zA-Z][\w-]*)/);
  return m ? m[1] : null;
}

export function analyze(files: string[]): Clash[] {
  const map = new Map<string, Map<string, ClassUse>>();
  for (const file of files) {
    for (const r of parseRules(fs.readFileSync(file, "utf8"))) {
      for (const part of r.selector.split(",")) {
        const cls = firstClass(part);
        if (!cls) continue;
        const byFile = map.get(cls) ?? new Map<string, ClassUse>();
        const use = byFile.get(file) ?? { file, selectors: [], props: [] };
        use.selectors.push(part.trim().replace(/\s+/g, " "));
        for (const p of r.props) if (!use.props.includes(p)) use.props.push(p);
        byFile.set(file, use);
        map.set(cls, byFile);
      }
    }
  }
  return [...map.entries()]
    .filter(([, f]) => f.size > 1)
    .map(([cls, f]) => ({ cls, uses: [...f.values()] }))
    .sort((a, b) => Number(b.cls.startsWith("plx-")) - Number(a.cls.startsWith("plx-")) || a.cls.localeCompare(b.cls));
}

export function format(clashes: Clash[], root: string): string {
  return clashes
    .map((c) => `.${c.cls}\n` + c.uses.map((u) => `    ${path.relative(root, u.file)}: ${u.props.join(", ")}\n      e.g. ${u.selectors.slice(0, 3).join(" | ")}`).join("\n"))
    .join("\n\n");
}

if (process.argv[1] && process.argv[1].endsWith("css-class-clashes.ts")) {
  const root = process.cwd();
  const files = walkCss(path.join(root, process.argv.includes("--all") ? "app" : "app/dashboard/_v3"));
  const clashes = analyze(files);
  console.log(clashes.length ? format(clashes, root) : "No class is styled by two different stylesheets.");
  console.log(`\n${clashes.length} clashing classes across ${files.length} files`);
}
