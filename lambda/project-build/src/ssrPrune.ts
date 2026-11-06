// Build-only packages that a server-rendered Astro function doesn't need at run time. They are
// removed after `npm prune --omit=dev` so the function bundle stays under Lambda's 50MB
// direct-upload limit (the Astro replica's bundle was 54MB zipped; these were ~30MB of it).
import { readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Whole package or scope folders under node_modules. */
export const BUILD_ONLY_PACKAGES = ["vite", "@rolldown"];
/** Packages whose native binaries are per platform: lightningcss and lightningcss-linux-x64-gnu, etc. */
export const BUILD_ONLY_PREFIXES = ["lightningcss"];

/** Removes build-only packages from a node_modules folder. Returns the names removed. */
export function pruneBuildOnlyPackages(nodeModulesDir: string): string[] {
  if (!existsSync(nodeModulesDir)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(nodeModulesDir)) {
    const buildOnly =
      BUILD_ONLY_PACKAGES.includes(name) ||
      BUILD_ONLY_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix + "-"));
    if (!buildOnly) continue;
    rmSync(join(nodeModulesDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed.sort();
}
