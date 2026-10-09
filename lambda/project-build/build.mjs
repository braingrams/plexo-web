// Bundles the build Lambda's three entry points into dist/ (run inside the Docker build).
// esbuild stays external: it's a native binary the worker loads from node_modules to bundle
// a project's server functions.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node24", format: "esm", logLevel: "info" };

await build({
  ...common,
  entryPoints: { index: "src/handler.ts", worker: "src/worker.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  external: ["esbuild"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

// Bundled into every server function by the worker — keep it free of non-built-in imports.
await build({ ...common, entryPoints: { functionRuntime: "src/functionRuntime.ts" }, outdir: "dist", outExtension: { ".js": ".mjs" } });
