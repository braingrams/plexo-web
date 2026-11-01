// What the SSR build runs for each framework. Pure data, so the plan is testable without npm.
// Every command is an npm CLI invocation (the image's /opt/npm), run in the app's root with no
// AWS credentials, the same isolation as the static build (worker.ts).
import type { BuildJob } from "../../../lib/projects/buildJob";

type SsrFramework = NonNullable<BuildJob["ssrFramework"]>;

/** Pinned to the version the existing OpenNext deployment uses (package.json of plexo-web). */
export const OPEN_NEXT_PACKAGE = "@opennextjs/aws@^4.1.4";

export type SsrPlan = {
  framework: SsrFramework;
  /** Extra environment for the build (never secrets). */
  env: Record<string, string>;
  /** npm invocations run after the install, in order: each is the argument list for npm. */
  buildSteps: string[][];
  /** Packages installed on top of the app's own dependencies, without saving them to its package.json. */
  extraInstalls: string[][];
  /** Where the built static files live, relative to the app root. Copied to the site prefix. */
  clientDir: string;
  /** How the server is packaged. "folder": the output folder is the function, with `index.mjs` at its root.
   * "bundle": esbuild bundles the server entry plus a Lambda adapter (`shim`) into one `index.mjs`. */
  server:
    | { kind: "folder"; dir: string; entry: "index.mjs" }
    | { kind: "bundle"; entryCandidates: string[]; shim: "remix" }
    | { kind: "shimmed"; serverDir: string; entryCandidates: string[]; shim: "astro" };
  // "shimmed": the server stays unbundled (bundling Astro's entry stalls at import), ships with
  // production node_modules, and index.mjs (the Lambda adapter) loads it by a runtime URL.
};

export function planSsrBuild(framework: SsrFramework): SsrPlan {
  switch (framework) {
    case "nextjs":
      // open-next packages the Next.js server (and its .next output) into one function folder.
      // Image optimization (next/image) needs its own function and is not covered yet.
      return {
        framework,
        env: {},
        buildSteps: [["exec", "--", "open-next", "build"]], // runs the Next.js build itself
        // --include=dev: under NODE_ENV=production npm would otherwise drop the app's devDependencies here too.
        extraInstalls: [["install", "--no-save", "--ignore-scripts", "--include=dev", "--no-audit", "--no-fund", OPEN_NEXT_PACKAGE]],
        clientDir: ".open-next/assets",
        server: { kind: "folder", dir: ".open-next/server-functions/default", entry: "index.mjs" },
      };
    case "nuxt":
    case "nitro":
      // The Nitro aws-lambda preset writes `.output/server/index.mjs` exporting `handler`.
      return {
        framework,
        env: { NITRO_PRESET: "aws-lambda" },
        buildSteps: [["run", "build"]],
        extraInstalls: [],
        clientDir: ".output/public",
        server: { kind: "folder", dir: ".output/server", entry: "index.mjs" },
      };
    case "remix":
      // Remix (Vite compiler writes build/server/index.js; the classic compiler writes build/index.js).
      return {
        framework,
        env: {},
        buildSteps: [["run", "build"]],
        extraInstalls: [],
        clientDir: "build/client",
        server: { kind: "bundle", entryCandidates: ["build/server/index.js", "build/index.js"], shim: "remix" },
      };
    case "astro":
      // Astro's Node adapter in standalone mode starts its own server when its entry loads.
      return {
        framework,
        env: {},
        buildSteps: [["run", "build"]],
        extraInstalls: [],
        clientDir: "dist/client",
        server: { kind: "shimmed", serverDir: "dist/server", entryCandidates: ["dist/server/entry.mjs"], shim: "astro" },
      };
  }
}

/** Frameworks whose build needs an adapter we can't guess: named so the customer gets a clear
 * message instead of a generic failure. */
export function missingAdapterMessage(framework: SsrFramework, deps: Record<string, unknown>): string | null {
  if (framework === "astro" && !("@astrojs/node" in deps)) {
    return "Astro server hosting needs the Node adapter: add @astrojs/node and set `output: 'server'` with `adapter: node({ mode: 'standalone' })`.";
  }
  if (framework === "remix" && !("@remix-run/node" in deps)) {
    return "Remix server hosting needs @remix-run/node in package.json.";
  }
  return null;
}
