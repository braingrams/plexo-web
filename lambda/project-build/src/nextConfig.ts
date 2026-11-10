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

/** The path the app's built assets (/_next/...) are served under: the web app's /__plexo/assets route. */
export const APP_ASSET_PREFIX = "/__plexo/assets";

/** The config source with `assetPrefix` set to `prefix`, unless the app already sets one. */
export function withAssetPrefix(source: string, prefix: string): { source: string; changed: boolean } {
  if (/\bassetPrefix\s*:/.test(source)) return { source, changed: false };
  const opening = /(\bconst\s+\w+\s*(?::\s*[\w.<>]+\s*)?=\s*\{|\bexport\s+default\s*\{|\bmodule\.exports\s*=\s*\{)/;
  const match = opening.exec(source);
  if (!match) return { source, changed: false };
  const at = match.index + match[0].length;
  return { source: `${source.slice(0, at)}\n  assetPrefix: "${prefix}",${source.slice(at)}`, changed: true };
}

/**
 * Prepares the app's Next.js config in its build folder (never the uploaded source): no static HTML export,
 * and the built assets under APP_ASSET_PREFIX. Returns what changed, one line per change.
 */
export function prepareNextConfig(appDir: string): string[] {
  for (const name of CONFIG_FILES) {
    const path = join(appDir, name);
    if (!existsSync(path)) continue;
    let source = readFileSync(path, "utf8");
    const changes: string[] = [];
    const exported = withoutStaticExport(source);
    if (exported.changed) {
      source = exported.source;
      changes.push("removed the static HTML export setting");
    }
    const prefixed = withAssetPrefix(source, APP_ASSET_PREFIX);
    if (prefixed.changed) {
      source = prefixed.source;
      changes.push(`serves built assets under ${APP_ASSET_PREFIX}`);
    }
    if (changes.length) writeFileSync(path, source);
    return changes.map((change) => `${name}: ${change}`);
  }
  return [];
}
