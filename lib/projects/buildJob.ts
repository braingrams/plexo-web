// The contract between the app (which queues builds) and lambda/project-build (which runs
// them). Dependency-free on purpose: the build Lambda imports this file and nothing else
// from the app, so its bundle — and its IAM blast radius — stays tiny.

export const BUILD_JOB_VERSION = 1;

export type BuildJob = {
  v: typeof BUILD_JOB_VERSION;
  buildId: string;
  templateId: string;
  versionId: string;
  /** preview: adds Select & Edit source locations (data-plexo-loc) for the editor.
   *  release: what gets published — clean output, no editor instrumentation. */
  mode: "preview" | "release";
  bucket: string;
  /** S3 key of the version manifest ({ files: [{ path, sha, size, contentType }] }). */
  manifestKey: string;
  /** S3 key prefix that file bodies live under: `${blobPrefix}/${sha}`. */
  blobPrefix: string;
  /** Where the built site goes: `${sitePrefix}/index.html`, `${sitePrefix}/__plexo/assets/…`. */
  sitePrefix: string;
  /** Where server-function bundles go: `${functionsPrefix}/<name>.zip`. */
  functionsPrefix: string;
  resultKey: string;
  logKey: string;
  /** Public URL path the build's hashed assets are served from (`/__plexo/assets/<buildId>/`). */
  assetBase: string;
  /** Build-time variables exposed to the app as import.meta.env.VITE_* — never secrets. */
  publicEnv: Record<string, string>;
  /** DynamoDB table holding the ProjectBuild row (ElectroDB lowercases keys: pk `pbuild#<buildId>`, sk `pbuild`). */
  buildsTable: string;
  /** "app" (default, a static site plus server functions) or "ssr" (a server-rendered app
   * built into a per-customer Lambda). Absent on jobs queued before SSR existed, so readers
   * must treat a missing kind as "app". */
  kind?: "app" | "ssr";
  /** SSR only: S3 key of the uploaded source zip (lib/projects/ssrSource.ts validated it). */
  ssrSourceKey?: string;
  /** SSR only: the framework detected at upload, which picks the build path. */
  ssrFramework?: "nextjs" | "nuxt" | "nitro" | "remix" | "astro";
  /** SSR only: the app-root folder inside the zip ("" or "my-site/"). */
  ssrRoot?: string;
};

export type BuildDiagnostic = {
  kind: "build" | "type" | "install" | "runtime";
  file?: string;
  line?: number;
  column?: number;
  message: string;
  snippet?: string;
};

export type BuildResult = {
  buildId: string;
  status: "SUCCEEDED" | "FAILED";
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  summary: string;
  functionBundles: Record<string, { key: string; schedule?: string; bytes: number }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export const assetBaseFor = (buildId: string) => `/__plexo/assets/${buildId}/`;
