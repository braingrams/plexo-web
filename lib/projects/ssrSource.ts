// Inspects a customer's SSR source zip: finds the app root (the folder holding package.json),
// reads the framework from its dependencies, and rejects anything the SSR build can't run.
// Pure apart from JSZip, so it runs in the app (route) and in tests without AWS.

import JSZip from "jszip";

export const SSR_MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const SSR_MAX_FILE_COUNT = 10_000;

/** Frameworks the SSR build knows how to produce a Lambda for. Nitro-family frameworks get
 * NITRO_PRESET=aws-lambda; Next.js goes through open-next; Remix and Astro get a shim. */
export type SsrFramework = "nextjs" | "nuxt" | "nitro" | "remix" | "astro";

export type SsrSourceResult =
  | { ok: true; framework: SsrFramework; root: string; packageJson: Record<string, unknown>; warnings: string[] }
  | { ok: false; error: string };

/** Frameworks that are switched off at upload for now. Their build code stays in
 * lambda/project-build/src/ssrPlan.ts, so turning one back on is a one-line change here.
 *
 * nextjs: switched off until `next/image` is handled. Image optimization needs its own function
 * and a working `sharp` install, and the build installs with --ignore-scripts today. */
export const SSR_DISABLED_FRAMEWORKS: SsrFramework[] = ["nextjs"];
const FRAMEWORK_NAMES: Record<SsrFramework, string> = { nextjs: "Next.js", nuxt: "Nuxt", nitro: "Nitro", remix: "Remix", astro: "Astro" };
const SUPPORTED_LIST = "Remix, Astro, Nuxt, Nitro";

const UNSUPPORTED_HINTS: Array<[string, string]> = [
  ["@sveltejs/kit", "SvelteKit"],
  ["@angular/core", "Angular"],
  ["solid-start", "SolidStart"],
  ["@tanstack/start", "TanStack Start"],
];

/** Picks the framework from a package.json's dependencies. Returns an error string when none
 * or more than one supported framework is present, or when a known-unsupported one is. */
export function detectSsrFramework(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): { framework: SsrFramework } | { error: string } {
  const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  const found: SsrFramework[] = [];
  if (has("next")) found.push("nextjs");
  if (has("nuxt")) found.push("nuxt");
  if (has("nitropack") && !has("nuxt")) found.push("nitro");
  if (Object.keys(deps).some((d) => d.startsWith("@remix-run/"))) found.push("remix");
  if (has("astro")) found.push("astro");

  const disabled = found.find((f) => SSR_DISABLED_FRAMEWORKS.includes(f));
  if (disabled) return { error: `${FRAMEWORK_NAMES[disabled]} server hosting is turned off for now. Supported: ${SUPPORTED_LIST}.` };
  if (found.length === 1) return { framework: found[0] };
  if (found.length > 1) return { error: `Found more than one server framework (${found.join(", ")}). Keep one framework in package.json.` };
  const unsupported = UNSUPPORTED_HINTS.find(([name]) => has(name));
  if (unsupported) return { error: `${unsupported[1]} isn't supported for server hosting yet. Supported: ${SUPPORTED_LIST}.` };
  return { error: `No supported server framework found in package.json. Supported: ${SUPPORTED_LIST}.` };
}

/** Zip-slip guard: the first entry name that is absolute, climbs out with "..", or uses backslashes. */
export function findUnsafeEntry(names: string[]): string | null {
  return names.find((name) => name.startsWith("/") || name.split("/").includes("..") || name.includes("\\")) ?? null;
}

/** Finds the app root: the zip's own top level, or a single wrapper folder around it. */
function findRoot(names: string[]): string | null {
  if (names.includes("package.json")) return "";
  const first = names[0]?.split("/")[0];
  if (!first) return null;
  const sameWrapper = names.every((n) => n.startsWith(`${first}/`));
  return sameWrapper && names.includes(`${first}/package.json`) ? `${first}/` : null;
}

export async function inspectSsrSource(buffer: Uint8Array): Promise<SsrSourceResult> {
  if (buffer.byteLength > SSR_MAX_ZIP_BYTES) {
    return { ok: false, error: `Source zip exceeds the ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB limit.` };
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { ok: false, error: "Could not read the uploaded file as a zip archive." };
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length === 0) return { ok: false, error: "Zip archive is empty." };
  if (files.length > SSR_MAX_FILE_COUNT) return { ok: false, error: `Zip contains too many files (max ${SSR_MAX_FILE_COUNT}).` };
  const names = files.map((f) => f.name);
  const unsafe = findUnsafeEntry(names);
  if (unsafe) return { ok: false, error: `Unsafe path in zip: "${unsafe}".` };

  const root = findRoot(names);
  if (root === null) {
    return { ok: false, error: "No package.json found at the root of the zip. Zip the project folder's contents, including package.json." };
  }

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(await zip.file(`${root}package.json`)!.async("string"));
  } catch {
    return { ok: false, error: "package.json isn't valid JSON." };
  }

  const detected = detectSsrFramework(packageJson as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> });
  if ("error" in detected) return { ok: false, error: detected.error };
  const warnings: string[] = [];
  if (names.some((name) => name.startsWith(`${root}node_modules/`))) {
    warnings.push("node_modules in this upload will be dropped. The build installs dependencies from package.json and package-lock.json.");
  }
  return { ok: true, framework: detected.framework, root, packageJson, warnings };
}
