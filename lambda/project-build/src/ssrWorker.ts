// The SSR build itself: install the app's dependencies, run the framework's build, and lay out
// the server function (a folder, or one bundled index.mjs with a Lambda adapter) and the static
// client files. Runs as a CHILD process of the handler with a scrubbed environment: a project
// can run its own code during install and build, and none of it may reach AWS.
//
// Usage: node ssrWorker.mjs <input.json> <result.json>
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { build as esbuild } from "esbuild";
import { prepareNextConfig } from "./nextConfig";
import { planSsrBuild } from "./ssrPlan";
import { remixShim, astroFunctionShim, SECRETS_LOADER_SOURCE, ENTRY_WRAPPER_SOURCE } from "./ssrShims";
import { pruneBuildOnlyPackages } from "./ssrPrune";

export type SsrWorkerInput = {
  appDir: string; // the unpacked source, with package.json at its root
  fnDir: string; // where the server function is laid out (zipped by the handler)
  clientOut: string; // where static client files are copied (uploaded by the handler)
  npmCli: string; // /opt/npm/bin/npm-cli.js
  cacheDir: string; // a per-build npm cache
  framework: Parameters<typeof planSsrBuild>[0];
  hasLockfile: boolean;
  imageFnDir?: string; // where the image-optimization function is laid out, when the plan has one
  /** Build-time variables (never secrets): passed to the build's environment and baked in. */
  buildEnv?: Record<string, string>;
};

export type SsrWorkerOutput = {
  ok: boolean;
  errors: Array<{ kind: "install" | "build" | "bundle"; message: string; snippet?: string }>;
  log: string;
  hasClient: boolean;
};

/** The child's environment: PATH and HOME only, plus what npm and the build need. No AWS_*. */
/** The app's dependencies from its package.json. Empty when the file is missing or unreadable. */
function readAppDependencies(appDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  } catch {
    return {};
  }
}

function scrubbedEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: "/var/lang/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp/plexo/home",
    NODE_ENV: "production",
    CI: "1",
    npm_config_update_notifier: "false",
    ...extra,
  };
}

function runNode(args: string[], cwd: string, env: Record<string, string>, log: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: scrubbedEnv(env), stdio: ["ignore", "pipe", "pipe"] });
    // Output goes to our stdout as it arrives, so the handler can stream it to the live build log.
    const emit = (chunk: Buffer) => {
      const text = chunk.toString();
      log.push(text);
      process.stdout.write(text);
    };
    child.stdout.on("data", emit);
    child.stderr.on("data", emit);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const tail = (log: string[], lines = 40) => log.join("").split("\n").slice(-lines).join("\n");

async function main() {
  const [inputPath, resultPath] = process.argv.slice(2);
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as SsrWorkerInput;
  const plan = planSsrBuild(input.framework);
  const log: string[] = [];
  const errors: SsrWorkerOutput["errors"] = [];
  const npm = (args: string[]) => [input.npmCli, ...args, "--no-audit", "--no-fund", "--cache", input.cacheDir];
  const env = { ...plan.env, ...(input.buildEnv ?? {}), npm_config_cache: input.cacheDir };

  const finish = (hasClient: boolean) => {
    const output: SsrWorkerOutput = { ok: errors.length === 0, errors, log: log.join(""), hasClient };
    writeFileSync(resultPath, JSON.stringify(output));
  };

  // 1. Install the app's own dependencies (no install scripts: nothing runs before the build).
  const install = input.hasLockfile ? "ci" : "install";
  // --include=dev: the child runs with NODE_ENV=production, which makes npm skip devDependencies,
  // and frameworks keep their build tools (vite, @remix-run/dev, typescript) there.
  if ((await runNode(npm([install, "--ignore-scripts", "--include=dev"]), input.appDir, env, log)) !== 0) {
    errors.push({ kind: "install", message: "Installing dependencies failed. Check package.json and the lockfile.", snippet: tail(log, 20) });
    return finish(false);
  }
  for (const extra of plan.extraInstalls) {
    if ((await runNode(npm(extra), input.appDir, env, log)) !== 0) {
      errors.push({ kind: "install", message: `Installing ${extra[extra.length - 1]} failed.`, snippet: tail(log, 20) });
      return finish(false);
    }
  }

  // 2. The framework's build. The Next.js config is prepared first: no static HTML export (which would hide the
  // server build), and built assets under the app asset prefix (served by the web app).
  if (input.framework === "nextjs") {
    for (const change of prepareNextConfig(input.appDir)) {
      const line = `Next.js config, ${change}.\n`;
      log.push(line);
      process.stdout.write(line);
    }
  }
  for (const step of plan.buildSteps) {
    if ((await runNode(npm(step), input.appDir, env, log)) !== 0) {
      errors.push({ kind: "build", message: `The server build failed (${step.join(" ")}).`, snippet: tail(log) });
      return finish(false);
    }
  }

  // 3. The server function.
  mkdirSync(input.fnDir, { recursive: true });
  if (plan.server.kind === "folder") {
    const src = join(input.appDir, plan.server.dir);
    if (!existsSync(join(src, plan.server.entry))) {
      errors.push({ kind: "build", message: `The build didn't produce ${plan.server.dir}/${plan.server.entry}.` });
      return finish(false);
    }
    cpSync(src, input.fnDir, { recursive: true });
    if (plan.image && input.imageFnDir) {
      const imageSrc = join(input.appDir, plan.image.dir);
      if (!existsSync(join(imageSrc, "index.mjs"))) {
        errors.push({ kind: "build", message: `The build didn't produce ${plan.image.dir}/index.mjs (the image optimizer).` });
        return finish(false);
      }
      cpSync(imageSrc, input.imageFnDir, { recursive: true });
    }
  } else if (plan.server.kind === "shimmed") {
    // Astro: ship dist/server unbundled, plus production node_modules, with index.mjs as the adapter.
    const entryRel = plan.server.entryCandidates.find((candidate) => existsSync(join(input.appDir, candidate)));
    if (!entryRel) {
      errors.push({ kind: "build", message: `The build didn't produce a server entry (looked for ${plan.server.entryCandidates.join(", ")}).` });
      return finish(false);
    }
    cpSync(join(input.appDir, plan.server.serverDir), join(input.fnDir, plan.server.serverDir), { recursive: true });
    if ((await runNode(npm(["prune", "--omit=dev", "--ignore-scripts"]), input.appDir, env, log)) !== 0) {
      errors.push({ kind: "build", message: "Pruning development dependencies for the server function failed.", snippet: tail(log, 20) });
      return finish(false);
    }
    // Build-only packages (Vite, Rolldown, LightningCSS) aren't needed to serve pages, and they push
    // the bundle past Lambda's 50MB direct-upload limit.
    pruneBuildOnlyPackages(join(input.appDir, "node_modules"));
    cpSync(join(input.appDir, "node_modules"), join(input.fnDir, "node_modules"), { recursive: true });
    writeFileSync(join(input.fnDir, "index.mjs"), astroFunctionShim("./" + entryRel.split("\\").join("/")));
  } else {
    const entryRel = plan.server.entryCandidates.find((candidate) => existsSync(join(input.appDir, candidate)));
    if (!entryRel) {
      errors.push({ kind: "build", message: `The build didn't produce a server entry (looked for ${plan.server.entryCandidates.join(", ")}).` });
      return finish(false);
    }
    // The shim lives in its own folder so esbuild resolves the app's node_modules from the app root.
    const shimDir = join(input.appDir, ".plexo-ssr");
    mkdirSync(shimDir, { recursive: true });
    const entryImport = "./" + relative(shimDir, join(input.appDir, entryRel)).split("\\").join("/");
    // React Router framework mode ships its request handler in `react-router`; Remix in @remix-run/node.
    const appDeps = readAppDependencies(input.appDir);
    const requestHandlerPackage = "@react-router/node" in appDeps || "@react-router/dev" in appDeps ? "react-router" : "@remix-run/node";
    const shimSource = remixShim(entryImport, requestHandlerPackage);
    const shimPath = join(shimDir, "shim.mjs");
    writeFileSync(shimPath, shimSource);
    try {
      await esbuild({
        entryPoints: [shimPath],
        outfile: join(input.fnDir, "index.mjs"),
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        absWorkingDir: input.appDir,
        logLevel: "silent",
        banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      });
    } catch (err: any) {
      errors.push({ kind: "bundle", message: "Bundling the server function failed.", snippet: String(err?.message ?? err).slice(0, 2000) });
      return finish(false);
    }
  }

  // 3b. Secrets are loaded before the server code runs, so the code never sees a secret it can't
  // read at start. The original entry becomes app.mjs, and a loader becomes index.mjs.
  if (existsSync(join(input.fnDir, "index.mjs"))) {
    renameSync(join(input.fnDir, "index.mjs"), join(input.fnDir, "app.mjs"));
    writeFileSync(join(input.fnDir, "plexo-env.mjs"), SECRETS_LOADER_SOURCE);
    writeFileSync(join(input.fnDir, "index.mjs"), ENTRY_WRAPPER_SOURCE);
  }

  // 4. Static client files.
  const clientSrc = join(input.appDir, plan.clientDir);
  const hasClient = existsSync(clientSrc);
  if (hasClient) {
    mkdirSync(input.clientOut, { recursive: true });
    cpSync(clientSrc, input.clientOut, { recursive: true });
  }
  return finish(hasClient);
}

main().catch((err) => {
  console.error("ssrWorker crashed", err);
  process.exitCode = 1;
});
