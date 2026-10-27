// The build itself: install (if needed), Vite build, type-check, bundle server functions.
// Runs as a CHILD process of the handler with a scrubbed environment — no AWS credentials,
// nothing but PATH/HOME — because a project can make Vite/Tailwind execute its own code
// (a Tailwind JS plugin, a PostCSS config). Whatever that code does, it can't reach AWS.
// It only sees the project's own files in its working directory.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import { parseBuildError, parseTscOutput, parseNpmError } from "../../../lib/projects/diagnostics";
import type { BuildDiagnostic } from "../../../lib/projects/buildJob";
import { sourceLocPlugin } from "./sourceLocPlugin";

export type WorkerInput = {
  workDir: string;
  outDir: string;
  fnOutDir: string;
  baseDir: string; // /opt/base — pre-installed scaffold dependencies
  buildId: string;
  mode: "preview" | "release";
  assetBase: string;
  publicEnv: Record<string, string>;
  installMode: "base" | "cached" | "install";
  npmCli: string;
  runtimePath: string; // function runtime adapter bundled into every function
  cacheDir: string;
};

export type WorkerOutput = {
  ok: boolean;
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  functions: Record<string, { file: string; schedule?: string; bytes: number }>;
  log: string;
  timings: Record<string, number>;
};

const logLines: string[] = [];
const log = (line: string) => logLines.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ code: number; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (d: Buffer) => {
      if (output.length < 400_000) output += d.toString();
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output, timedOut });
    });
  });
}

async function install(input: WorkerInput): Promise<BuildDiagnostic[]> {
  const nodeModules = join(input.workDir, "node_modules");
  if (input.installMode === "base") {
    rmSync(nodeModules, { recursive: true, force: true });
    symlinkSync(join(input.baseDir, "node_modules"), nodeModules, "dir");
    log("Dependencies: using Plexo's pre-installed set.");
    return [];
  }
  if (input.installMode === "cached" && existsSync(nodeModules)) {
    log("Dependencies: restored from this project's cache.");
    return [];
  }
  log("Dependencies: installing from npm…");
  const res = await run(
    process.execPath,
    [input.npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error", "--prefer-offline", `--cache=${input.cacheDir}/npm`],
    { cwd: input.workDir, timeoutMs: 6 * 60 * 1000 },
  );
  if (res.timedOut) return [{ kind: "install", file: "package.json", message: "Installing packages took longer than 6 minutes. Remove large or unusual packages from package.json." }];
  if (res.code !== 0) {
    log(res.output.slice(-4000));
    return parseNpmError(res.output);
  }
  log("Dependencies installed.");
  return [];
}

function resolveFrom(dir: string, specifier: string): string {
  return createRequire(join(dir, "package.json")).resolve(specifier);
}

async function viteBuild(input: WorkerInput, warnings: BuildDiagnostic[]): Promise<BuildDiagnostic[]> {
  // Plexo's own toolchain from the image, regardless of what the project pinned — the build
  // pipeline (asset paths, plugins, output layout) is Plexo's contract, not the project's.
  const base = input.baseDir;
  const vite = await import(pathToFileURL(resolveFrom(base, "vite")).href);
  const react = (await import(pathToFileURL(resolveFrom(base, "@vitejs/plugin-react")).href)).default;
  const tailwind = (await import(pathToFileURL(resolveFrom(base, "@tailwindcss/vite")).href)).default;

  if (!existsSync(join(input.workDir, "index.html"))) {
    return [{ kind: "build", file: "index.html", message: "index.html is missing. Every app needs an index.html at the project root that loads /src/main.tsx." }];
  }

  const define: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.publicEnv)) define[`import.meta.env.${k}`] = JSON.stringify(v);

  const logger = vite.createLogger("warn", { allowClearScreen: false });
  const origWarn = logger.warn.bind(logger);
  logger.warn = (msg: string, opts?: unknown) => {
    const text = msg.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (text && !/chunks are larger than|Generated an empty chunk/i.test(text) && warnings.length < 30) warnings.push({ kind: "build", message: text.slice(0, 500) });
    log(`warn: ${text.slice(0, 300)}`);
    origWarn(msg, opts as never);
  };

  try {
    await vite.build({
      root: input.workDir,
      base: "/",
      configFile: false,
      envDir: false,
      mode: "production",
      logLevel: "warn",
      customLogger: logger,
      cacheDir: join(input.cacheDir, "vite"),
      plugins: [...(input.mode === "preview" ? [sourceLocPlugin(input.workDir, vite.parseSync)] : []), react(), tailwind()],
      resolve: { alias: { "@": join(input.workDir, "src") } },
      define,
      build: {
        outDir: input.outDir,
        emptyOutDir: true,
        assetsDir: input.assetBase.replace(/^\/|\/$/g, ""),
        sourcemap: "hidden",
        reportCompressedSize: false,
        chunkSizeWarningLimit: 4096,
      },
    });
    log("App built.");
    return [];
  } catch (err) {
    log(`Build failed: ${String((err as Error)?.message ?? err).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 3000)}`);
    return parseBuildError(err, input.workDir);
  }
}

async function typeCheck(input: WorkerInput): Promise<BuildDiagnostic[]> {
  if (!existsSync(join(input.workDir, "tsconfig.json"))) return [];
  // typescript's exports map hides bin/, so locate it from its package.json.
  let tscBin: string;
  try {
    const pkgPath = resolveFrom(input.baseDir, "typescript/package.json");
    const bin = JSON.parse(readFileSync(pkgPath, "utf8")).bin;
    tscBin = join(pkgPath, "..", typeof bin === "string" ? bin : bin.tsc);
  } catch {
    log("Type check skipped (TypeScript isn't available).");
    return [];
  }
  const res = await run(process.execPath, [tscBin, "--noEmit", "--pretty", "false", "-p", "tsconfig.json"], { cwd: input.workDir, timeoutMs: 120_000 });
  if (res.timedOut) {
    log("Type check skipped (took over 2 minutes).");
    return [];
  }
  const diags = parseTscOutput(res.output, input.workDir);
  log(diags.length ? `Type check: ${diags.length} problem(s).` : "Type check passed.");
  return diags;
}

async function bundleFunctions(input: WorkerInput, errors: BuildDiagnostic[]): Promise<WorkerOutput["functions"]> {
  const dir = join(input.workDir, "functions");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return {};
  const entries = readdirSync(dir).filter((f) => /^[a-z0-9][a-z0-9-_]*\.(ts|js|mjs)$/i.test(f) && !/^types\.(ts|js)$/.test(f));
  if (!entries.length) return {};
  const esbuild = await import("esbuild");
  mkdirSync(input.fnOutDir, { recursive: true });
  const out: WorkerOutput["functions"] = {};
  for (const file of entries) {
    const name = file.replace(/\.(ts|js|mjs)$/, "").toLowerCase();
    const source = readFileSync(join(dir, file), "utf8");
    if (!/export\s+default\b/.test(source)) {
      errors.push({ kind: "build", file: `functions/${file}`, message: "A server function needs a default export: export default async (req, ctx) => Response.json({ ... })." });
      continue;
    }
    const schedule = source.match(/export\s+const\s+schedule\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];
    const entry = join(input.workDir, `.plexo-fn-${name}.mjs`);
    writeFileSync(entry, `import userHandler from ${JSON.stringify(join(dir, file))};\nimport { createHandler } from ${JSON.stringify(input.runtimePath)};\nexport const handler = createHandler(userHandler, ${JSON.stringify(name)});\n`);
    try {
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        write: false,
        outfile: "index.mjs",
        logLevel: "silent",
        // Lets bundled CommonJS packages still call require() for Node built-ins.
        banner: { js: "import { createRequire as __plexoCreateRequire } from 'node:module'; const require = __plexoCreateRequire(import.meta.url);" },
      });
      const code = result.outputFiles[0].contents;
      const zip = zipSync({ "index.mjs": code }, { level: 6 });
      const zipPath = join(input.fnOutDir, `${name}.zip`);
      writeFileSync(zipPath, zip);
      out[name] = { file: zipPath, schedule, bytes: zip.length };
      log(`Function "${name}" bundled (${Math.round(zip.length / 1024)} KB)${schedule ? `, runs on schedule "${schedule}"` : ""}.`);
    } catch (err: any) {
      for (const e of err?.errors ?? [{ text: String(err?.message ?? err) }]) {
        errors.push({
          kind: "build",
          file: e.location?.file ? e.location.file.replace(`${input.workDir}/`, "") : `functions/${file}`,
          line: e.location?.line,
          column: e.location?.column !== undefined ? e.location.column + 1 : undefined,
          message: e.text,
          snippet: e.location?.lineText,
        });
      }
    }
  }
  return out;
}

/** A project without package.json is a static site (or a dist/ built elsewhere, sent through
 * the Deploy API): its files are published exactly as they are. */
function isStaticSite(workDir: string): boolean {
  return !existsSync(join(workDir, "package.json")) && existsSync(join(workDir, "index.html"));
}

function copyStatic(input: WorkerInput): void {
  for (const entry of readdirSync(input.workDir)) {
    if (entry === "node_modules" || entry === "functions" || entry === "db" || entry.startsWith(".plexo")) continue;
    cpSync(join(input.workDir, entry), join(input.outDir, entry), { recursive: true });
  }
  log("Static site: published the files as they are.");
}

async function main() {
  const input = JSON.parse(readFileSync(process.argv[2], "utf8")) as WorkerInput;
  const resultPath = process.argv[3];
  const timings: Record<string, number> = {};
  const errors: BuildDiagnostic[] = [];
  const warnings: BuildDiagnostic[] = [];
  let functions: WorkerOutput["functions"] = {};

  if (isStaticSite(input.workDir)) {
    copyStatic(input);
    const output: WorkerOutput = { ok: true, errors, warnings, functions: {}, log: logLines.join("\n"), timings };
    writeFileSync(resultPath, JSON.stringify(output));
    return;
  }

  let t = Date.now();
  const installErrors = await install(input);
  timings.install = Date.now() - t;
  errors.push(...installErrors);

  if (!installErrors.length) {
    t = Date.now();
    // Build and type-check concurrently — the type check never blocks the build.
    const [buildErrors, typeErrors] = await Promise.all([viteBuild(input, warnings), typeCheck(input)]);
    timings.build = Date.now() - t;
    errors.push(...buildErrors);
    warnings.unshift(...typeErrors);
    t = Date.now();
    functions = await bundleFunctions(input, errors);
    timings.functions = Date.now() - t;
  }

  const output: WorkerOutput = { ok: errors.length === 0, errors, warnings, functions, log: logLines.join("\n"), timings };
  writeFileSync(resultPath, JSON.stringify(output));
}

main().catch((err) => {
  const output: WorkerOutput = {
    ok: false,
    errors: [{ kind: "build", message: `The build crashed: ${String(err?.message ?? err).slice(0, 1000)}` }],
    warnings: [],
    functions: {},
    log: logLines.join("\n"),
    timings: {},
  };
  writeFileSync(process.argv[3], JSON.stringify(output));
  process.exit(0);
});
