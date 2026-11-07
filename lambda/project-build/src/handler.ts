// ProjectBuildFn — consumes build jobs from SQS (lib/projects/builds.ts queues them).
//
// Security model (docs/plexo-projects/ARCHITECTURE.md §2):
// - This function's own role can only assume BuildWorkerRole and consume its queue.
// - For each job it assumes BuildWorkerRole with a SESSION POLICY narrowing it to exactly
//   this project's S3 prefix and this build's DynamoDB row, so even a bug here can't touch
//   another project.
// - The actual build (worker.ts) runs in a child process with no AWS credentials at all —
//   a project can make the toolchain run its own code, and that code must not reach AWS.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, createWriteStream } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { BUILD_JOB_VERSION, type BuildJob, type BuildResult, type BuildDiagnostic } from "../../../lib/projects/buildJob";
import { planInstall, InstallPlanError, type BaseVersions } from "./installPlan";
import { missingAdapterMessage } from "./ssrPlan";
import type { WorkerInput, WorkerOutput } from "./worker";
import type { SsrWorkerInput, SsrWorkerOutput } from "./ssrWorker";
import { unzipSync, zipSync } from "fflate";

const REGION = process.env.AWS_REGION || "us-east-1";
const WORKER_ROLE_ARN = process.env.BUILD_WORKER_ROLE_ARN!;
const BASE_DIR = "/opt/base";
const NPM_CLI = "/opt/npm/bin/npm-cli.js";
const TMP = "/tmp/plexo";
const sts = new STSClient({ region: REGION });
// The function's own role (not the per-build scoped one) may send to this one queue only.
const sqs = new SQSClient({ region: REGION });

/** Tells the app the build is done, so its post-build steps run right away
 * (lambda/build-finalize). Best effort: a poll from the editor finalizes it too. */
async function announce(buildId: string): Promise<void> {
  const queueUrl = process.env.BUILD_EVENTS_QUEUE_URL;
  if (!queueUrl) return;
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ buildId }) })).catch((err) => console.error("announce failed", err));
}

let baseVersions: BaseVersions | null = null;
function loadBaseVersions(): BaseVersions {
  if (baseVersions) return baseVersions;
  const versions: BaseVersions = {};
  const nm = join(BASE_DIR, "node_modules");
  for (const entry of readdirSync(nm)) {
    const dirs = entry.startsWith("@") ? readdirSync(join(nm, entry)).map((d) => `${entry}/${d}`) : [entry];
    for (const name of dirs) {
      try {
        versions[name] = JSON.parse(readFileSync(join(nm, name, "package.json"), "utf8")).version;
      } catch {
        // not a package (e.g. .bin)
      }
    }
  }
  return (baseVersions = versions);
}

async function scopedClients(job: BuildJob) {
  const projectArn = `arn:aws:s3:::${job.bucket}/private/projects/${job.templateId}`;
  const policy = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["s3:GetObject"], Resource: [`${projectArn}/blobs/*`, `${projectArn}/versions/*`, `${projectArn}/deps/*`, `${projectArn}/builds/${job.buildId}/*`] },
      { Effect: "Allow", Action: ["s3:PutObject"], Resource: [`${projectArn}/builds/${job.buildId}/*`, `${projectArn}/deps/*`] },
      // The app's latest uploaded source (kept after builds so a rebuild needs no re-upload).
      { Effect: "Allow", Action: ["s3:GetObject"], Resource: `${projectArn}/ssr/*` },
      // The saved-dependencies upload is tagged (plexo-cache=deps, for the bucket's expiry rule); a tagged PutObject also
      // needs this. Without it the first build of any project with extra dependencies crashed AFTER installing them.
      { Effect: "Allow", Action: ["s3:PutObjectTagging"], Resource: `${projectArn}/deps/*` },
      {
        Effect: "Allow",
        Action: ["dynamodb:UpdateItem"],
        Resource: `arn:aws:dynamodb:${REGION}:*:table/${job.buildsTable}`,
        // ElectroDB stores keys lowercased (lib/db/projectEntities.ts ProjectBuild).
        Condition: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [`pbuild#${job.buildId.toLowerCase()}`] } },
      },
    ],
  };
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({ RoleArn: WORKER_ROLE_ARN, RoleSessionName: `build-${job.buildId.slice(0, 32)}`, Policy: JSON.stringify(policy), DurationSeconds: 3600 }),
  );
  const credentials = { accessKeyId: Credentials!.AccessKeyId!, secretAccessKey: Credentials!.SecretAccessKey!, sessionToken: Credentials!.SessionToken! };
  return {
    s3: new S3Client({ region: REGION, credentials, maxAttempts: 8, retryMode: "adaptive" }),
    ddb: new DynamoDBClient({ region: REGION, credentials }),
  };
}

type Clients = Awaited<ReturnType<typeof scopedClients>>;

async function getBytes(s3: S3Client, bucket: string, key: string): Promise<Buffer | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404 || err?.$metadata?.httpStatusCode === 403) return null;
    throw err;
  }
}

async function exists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function setStatus(ddb: DynamoDBClient, job: BuildJob, fields: Record<string, unknown>, condition?: string): Promise<boolean> {
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries({ ...fields, updatedAt: new Date().toISOString() })) {
    names[`#${k}`] = k;
    values[`:${k}`] = toAttr(v);
    sets.push(`#${k} = :${k}`);
  }
  if (condition === "queued") {
    names["#status_c"] = "status";
    values[":queued"] = { S: "QUEUED" };
  }
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: job.buildsTable,
        Key: { pk: { S: `pbuild#${job.buildId.toLowerCase()}` }, sk: { S: "pbuild" } },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: condition === "queued" ? "#status_c = :queued" : "attribute_exists(pk)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

function toAttr(v: unknown): any {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === "string") return { S: v };
  if (typeof v === "number") return { N: String(v) };
  if (typeof v === "boolean") return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(toAttr) };
  return { M: Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toAttr(x)])) };
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json", map: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  txt: "text/plain; charset=utf-8", xml: "application/xml", webmanifest: "application/manifest+json", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf", wasm: "application/wasm",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function runWorker(input: WorkerInput, inputPath: string, resultPath: string): Promise<void> {
  writeFileSync(inputPath, JSON.stringify(input));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["/var/task/worker.mjs", inputPath, resultPath], {
      cwd: input.workDir,
      // Deliberately NOT process.env: no AWS_* credentials reach the child.
      env: { PATH: "/var/lang/bin:/usr/local/bin:/usr/bin:/bin", HOME: join(TMP, "home"), NODE_ENV: "production", npm_config_update_notifier: "false", CI: "1" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 13 * 60 * 1000);
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function processJob(job: BuildJob): Promise<void> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const { s3, ddb } = await scopedClients(job);

  // Only a still-QUEUED build runs: a cancelled (superseded) build, or a redelivered
  // message for a build that already ran, is skipped.
  if (!(await setStatus(ddb, job, { status: "BUILDING", startedAt }, "queued"))) {
    console.log(`Skipping build ${job.buildId}: no longer queued.`);
    return;
  }

  rmSync(TMP, { recursive: true, force: true });
  const workDir = join(TMP, "work");
  const outDir = join(TMP, "out");
  const fnOutDir = join(TMP, "fn");
  const cacheDir = join(TMP, "cache");
  const imgFnOut = join(TMP, "imgfn");
  for (const d of [workDir, outDir, fnOutDir, imgFnOut, cacheDir, join(TMP, "home")]) mkdirSync(d, { recursive: true });

  type FinishFn = (errors: BuildDiagnostic[], warnings: BuildDiagnostic[], log: string, functionBundles?: BuildResult["functionBundles"]) => Promise<void>;
  const finish: FinishFn = async (errors, warnings, log, functionBundles = {}) => {
    const durationMs = Date.now() - started;
    const failed = errors.length > 0;
    const result: BuildResult = {
      buildId: job.buildId,
      status: failed ? "FAILED" : "SUCCEEDED",
      errors,
      warnings,
      summary: failed
        ? `${errors.length} error${errors.length === 1 ? "" : "s"}${errors[0]?.file ? ` in ${errors[0].file}` : ""}`
        : `Built in ${(durationMs / 1000).toFixed(1)}s${warnings.some((w) => w.kind === "type") ? ` · ${warnings.filter((w) => w.kind === "type").length} type issue(s)` : ""}`,
      functionBundles,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
    };
    await s3.send(new PutObjectCommand({ Bucket: job.bucket, Key: job.logKey, Body: log, ContentType: "text/plain; charset=utf-8" }));
    await s3.send(new PutObjectCommand({ Bucket: job.bucket, Key: job.resultKey, Body: JSON.stringify(result), ContentType: "application/json" }));
    await setStatus(ddb, job, {
      status: result.status,
      errors: errors.slice(0, 100),
      warnings: warnings.slice(0, 100),
      summary: result.summary,
      functionBundles,
      finishedAt: result.finishedAt,
      durationMs,
    });
    if (!failed) await announce(job.buildId);
  };

  try {
    if (job.kind === "ssr") return await buildSsr(job, s3, finish, { workDir, outDir, fnOutDir, imgFnOut, cacheDir });
    const manifestBytes = await getBytes(s3, job.bucket, job.manifestKey);
    if (!manifestBytes) return await finish([{ kind: "build", message: "This version's file list is missing — save the project again and rebuild." }], [], "");
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as { files: Array<{ path: string; sha: string }> };

    await mapLimit(manifest.files, 32, async (f) => {
      // Paths were validated on write; re-check here so a crafted manifest can't escape workDir.
      const target = join(workDir, f.path);
      if (relative(workDir, target).startsWith("..") || f.path.startsWith("node_modules/")) return;
      const body = await getBytes(s3, job.bucket, `${job.blobPrefix}/${f.sha}`);
      if (!body) throw new Error(`Missing content for ${f.path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    });

    let plan;
    try {
      // No package.json: a static site — nothing to install (the worker copies it as is).
      plan = planInstall(existsSync(join(workDir, "package.json")) ? readFileSync(join(workDir, "package.json"), "utf8") : null, loadBaseVersions());
    } catch (err) {
      if (err instanceof InstallPlanError) return await finish([{ kind: "install", file: "package.json", message: err.message }], [], "");
      throw err;
    }

    let installMode: WorkerInput["installMode"] = "base";
    let depsKey: string | null = null;
    if (plan.mode !== "base") {
      depsKey = `private/projects/${job.templateId}/deps/${plan.depsHash}.tar.gz`;
      if (await exists(s3, job.bucket, depsKey)) {
        const res = await s3.send(new GetObjectCommand({ Bucket: job.bucket, Key: depsKey }));
        const tarPath = join(TMP, "deps.tar.gz");
        await pipeline(res.Body as Readable, createWriteStream(tarPath));
        await exec("tar", ["-xzf", tarPath, "-C", workDir]);
        installMode = "cached";
      } else {
        installMode = "install";
        // A fresh, per-build copy of the image's npm cache (never a cache shared with earlier
        // builds in this container: the child can write to it, and a poisoned shared cache
        // would let one project tamper with the next one's dependencies).
        await exec("cp", ["-R", "/opt/npm-cache", join(cacheDir, "npm")]);
      }
    }

    const input: WorkerInput = {
      workDir,
      outDir,
      fnOutDir,
      baseDir: BASE_DIR,
      buildId: job.buildId,
      mode: job.mode ?? "preview",
      assetBase: job.assetBase,
      publicEnv: job.publicEnv,
      installMode,
      npmCli: NPM_CLI,
      runtimePath: "/var/task/functionRuntime.mjs",
      cacheDir,
    };
    const resultPath = join(TMP, "result.json");
    await runWorker(input, join(TMP, "input.json"), resultPath);
    const output: WorkerOutput = existsSync(resultPath)
      ? JSON.parse(readFileSync(resultPath, "utf8"))
      : { ok: false, errors: [{ kind: "build", message: "The build ran out of time or memory. Large dependencies are the usual cause." }], warnings: [], functions: {}, log: "", timings: {} };

    // Save a fresh install for next time (only when it succeeded).
    if (installMode === "install" && depsKey && !output.errors.some((e) => e.kind === "install")) {
      const tarPath = join(TMP, "deps-out.tar.gz");
      await exec("tar", ["-czf", tarPath, "-C", workDir, "node_modules"]);
      await s3.send(new PutObjectCommand({ Bucket: job.bucket, Key: depsKey, Body: readFileSync(tarPath), ContentType: "application/gzip", Tagging: "plexo-cache=deps" }));
    }

    const functionBundles: BuildResult["functionBundles"] = {};
    if (output.ok) {
      const files = walk(outDir);
      await mapLimit(files, 24, async (file) => {
        const rel = relative(outDir, file).split("\\").join("/");
        const ext = rel.split(".").pop()!.toLowerCase();
        await s3.send(
          new PutObjectCommand({
            Bucket: job.bucket,
            Key: `${job.sitePrefix}/${rel}`,
            Body: readFileSync(file),
            ContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
            CacheControl: rel.startsWith("__plexo/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
          }),
        );
      });
      for (const [name, fn] of Object.entries(output.functions)) {
        const key = `${job.functionsPrefix}/${name}.zip`;
        const body = readFileSync(fn.file);
        await s3.send(new PutObjectCommand({ Bucket: job.bucket, Key: key, Body: body, ContentType: "application/zip", Metadata: { sha256: createHash("sha256").update(body).digest("hex") } }));
        functionBundles[name] = { key, schedule: fn.schedule, bytes: fn.bytes };
      }
    }
    const timing = Object.entries(output.timings).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(", ");
    await finish(output.errors, output.warnings, `${output.log}\n${timing ? `Timings: ${timing}` : ""}`, functionBundles);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

/** An SSR build: unpack the uploaded source, run the framework's build in a child process,
 * upload the server function as builds/<id>/functions/server.zip and the static files to the site prefix.
 * The source zip is only read; it stays so the app can be rebuilt without uploading again. */
async function buildSsr(
  job: BuildJob,
  s3: S3Client,
  finish: (errors: BuildDiagnostic[], warnings: BuildDiagnostic[], log: string, functionBundles?: BuildResult["functionBundles"]) => Promise<void>,
  dirs: { workDir: string; outDir: string; fnOutDir: string; imgFnOut: string; cacheDir: string },
): Promise<void> {
  if (!job.ssrSourceKey || !job.ssrFramework) {
    return await finish([{ kind: "build", message: "This SSR build is missing its source or framework. Upload the project again." }], [], "");
  }
  const sourceBytes = await getBytes(s3, job.bucket, job.ssrSourceKey);
  if (!sourceBytes) return await finish([{ kind: "build", message: "The uploaded source is missing. Upload the project again." }], [], "");

  // Unpack the app root (the folder with package.json) into the work directory. node_modules
  // from the upload is dropped: the build installs its own, so an upload can't pre-seed it.
  const root = job.ssrRoot ?? "";
  const entries = unzipSync(new Uint8Array(sourceBytes));
  for (const [name, body] of Object.entries(entries)) {
    if (name.endsWith("/") || !name.startsWith(root)) continue;
    const rel = name.slice(root.length);
    if (rel.startsWith("node_modules/")) continue;
    const target = join(dirs.workDir, rel);
    if (relative(dirs.workDir, target).startsWith("..")) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }

  const pkgPath = join(dirs.workDir, "package.json");
  if (!existsSync(pkgPath)) return await finish([{ kind: "build", file: "package.json", message: "No package.json was found in the uploaded source." }], [], "");
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return await finish([{ kind: "install", file: "package.json", message: "package.json isn't valid JSON." }], [], "");
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const adapterProblem = missingAdapterMessage(job.ssrFramework, deps);
  if (adapterProblem) return await finish([{ kind: "install", file: "package.json", message: adapterProblem }], [], "");

  const input: SsrWorkerInput = {
    appDir: dirs.workDir,
    fnDir: dirs.fnOutDir,
    clientOut: dirs.outDir,
    npmCli: NPM_CLI,
    cacheDir: dirs.cacheDir,
    framework: job.ssrFramework,
    hasLockfile: existsSync(join(dirs.workDir, "package-lock.json")),
    imageFnDir: dirs.imgFnOut,
    buildEnv: job.publicEnv,
  };
  const output = await runSsrWorker(input, join(TMP, "ssr-input.json"), join(TMP, "ssr-result.json"));
  if (!output.ok) {
    const errors: BuildDiagnostic[] = output.errors.map((e) => ({ kind: e.kind === "bundle" ? "build" : e.kind, message: e.message, snippet: e.snippet }));
    return await finish(errors, [], output.log);
  }

  // Each function is one zip with index.mjs at its root: the server, and the image optimizer when the plan has one.
  const zipFolder = async (dir: string, key: string) => {
    const files: Record<string, Uint8Array> = {};
    for (const file of walk(dir)) files[relative(dir, file).split("\\").join("/")] = readFileSync(file);
    const body = zipSync(files, { level: 6 });
    await s3.send(new PutObjectCommand({ Bucket: job.bucket, Key: key, Body: body, ContentType: "application/zip", Metadata: { sha256: createHash("sha256").update(body).digest("hex") } }));
    return { key, bytes: body.byteLength };
  };
  const server = await zipFolder(dirs.fnOutDir, `${job.functionsPrefix}/server.zip`);
  const imageBundle = existsSync(join(dirs.imgFnOut, "index.mjs"))
    ? await zipFolder(dirs.imgFnOut, `${job.functionsPrefix}/image.zip`)
    : null;

  // Static files: served from the site prefix, never through the function.
  if (output.hasClient) {
    await mapLimit(walk(dirs.outDir), 24, async (file) => {
      const rel = relative(dirs.outDir, file).split("\\").join("/");
      const ext = rel.split(".").pop()!.toLowerCase();
      await s3.send(new PutObjectCommand({
        Bucket: job.bucket,
        Key: `${job.sitePrefix}/${rel}`,
        Body: readFileSync(file),
        ContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
        CacheControl: rel.startsWith("_next/static/") || rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
      }));
    });
  }

  await finish([], [], output.log, { server, ...(imageBundle ? { image: imageBundle } : {}) });
}

function runSsrWorker(input: SsrWorkerInput, inputPath: string, resultPath: string): Promise<SsrWorkerOutput> {
  writeFileSync(inputPath, JSON.stringify(input));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["/var/task/ssrWorker.mjs", inputPath, resultPath], {
      cwd: input.appDir,
      // Same isolation as the static build: no AWS credentials reach the child.
      env: { PATH: "/var/lang/bin:/usr/local/bin:/usr/bin:/bin", HOME: join(TMP, "home"), NODE_ENV: "production", npm_config_update_notifier: "false", CI: "1" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 13 * 60 * 1000);
    child.on("close", () => {
      clearTimeout(timer);
      const output: SsrWorkerOutput = existsSync(resultPath)
        ? JSON.parse(readFileSync(resultPath, "utf8"))
        : { ok: false, errors: [{ kind: "build", message: "The server build ran out of time or memory. Large dependencies are the usual cause." }], log: "", hasClient: false };
      resolve(output);
    });
  });
}

function exec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    let job: BuildJob;
    try {
      job = JSON.parse(record.body);
      if (job.v !== BUILD_JOB_VERSION) throw new Error(`Unsupported build job version ${job.v}`);
    } catch (err) {
      console.error("Dropping malformed build job", err);
      continue;
    }
    try {
      await processJob(job);
    } catch (err: any) {
      console.error(`Build ${job.buildId} crashed`, err);
      // A crash in Plexo's own machinery (not the project's code — that's reported as a
      // normal failed build) is retried by SQS; the final attempt lands in the DLQ and the
      // app settles the build as timed out.
      failures.push({ itemIdentifier: record.messageId });
      try {
        const { ddb } = await scopedClients(job);
        await setStatus(ddb, job, { status: "QUEUED", summary: "Retrying after an internal error…" });
      } catch {
        // best effort
      }
    }
  }
  return { batchItemFailures: failures };
}
