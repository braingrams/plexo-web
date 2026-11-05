import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A Next.js project can set `output: 'export'`, which makes `next build` write static HTML only. A
// server app needs the server build that OpenNext packages, so for an SSR build the worker drops
// that setting first. Every other setting is left as it is.

const STATIC_EXPORT = /\boutput\s*:\s*(['"])export\1\s*,?/g;

/** The config source with `output: 'export'` removed, and whether anything was removed. */
export function withoutStaticExport(source: string): { source: string; changed: boolean } {
  const changed = STATIC_EXPORT.test(source);
  STATIC_EXPORT.lastIndex = 0;
  if (!changed) return { source, changed: false };
  return { source: source.replace(STATIC_EXPORT, "/* static HTML export removed by Plexo: this app is built as a server app */"), changed: true };
}

const CONFIG_FILES = ["next.config.ts", "next.config.mts", "next.config.js", "next.config.mjs", "next.config.cjs", "next.config.cts"];

/** Rewrites the app's Next.js config in its build folder (never the uploaded source). Returns the file it changed, if any. */
export function disableStaticExportInConfig(appDir: string): string | null {
  for (const name of CONFIG_FILES) {
    const path = join(appDir, name);
    if (!existsSync(path)) continue;
    const result = withoutStaticExport(readFileSync(path, "utf8"));
    if (!result.changed) return null;
    writeFileSync(path, result.source);
    return name;
  }
  return null;
}
