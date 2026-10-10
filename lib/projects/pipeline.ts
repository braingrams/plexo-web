import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { ProjectBuild, type ProjectBuildError } from "@/lib/db/projectEntities";
import { listFiles, snapshotVersion, getVersionManifest, diffManifests, type VersionSource, type FileDiff } from "./fileStore";
import { getBlob } from "./blobStore";
import { startBuild, getBuild, waitForBuild, isFinished, recordLatestBuild, type ProjectBuildItem } from "./builds";
import { settle } from "./settle";
import { upgradeAppClient } from "./clientUpgrade";
import { previewUrl } from "./previewHost";
import { applyMigrations, migrationFilesFrom, type MigrationOutcome } from "@/lib/appData/migrations";
import { deployFunctions, type DeployOutcome, type FunctionBundle } from "@/lib/appFunctions/deploy";
import { forgetAppContext } from "@/lib/appRuntime/context";
import { forgetSchemaVersion } from "@/lib/appRuntime/data";
import { databaseName } from "@/lib/appData/db";
import { linkDomainToTemplate } from "@/lib/sites/linkDomain";
import { isDomainLive } from "@/lib/plan/siteLimits";
import { effectivePlan } from "@/lib/plan/entitlement";
import { slugify } from "@/server/slugDynamo";

// The two things everyone (SOL, MCP, Code Mode, the Deploy API) actually wants:
//   preview: "show me my latest changes" — version → build → migrate the preview database →
//            deploy preview functions → one report of everything that broke.
//   publish: "put it live" — a clean release build → migrate the live database → deploy live
//            functions → switch the live site over → a working URL.
//
// Both are start-then-finish: start* returns right away with a build id; finalizeBuild runs
// the post-build steps exactly once (claimed on the build row), called by whoever checks on
// the build first — a poll from the editor, the Deploy API, or a blocking SOL call. So a
// request never has to stay open for a whole publish.

export type Actor = { userId: string; organizationId: string; userName?: string };

export type BuildReport = {
  ok: boolean;
  buildId: string;
  versionId: string;
  mode: "preview" | "release";
  status: ProjectBuildItem["status"];
  /** Still building, or post-build steps still running — poll again. */
  pending: boolean;
  summary: string;
  errors: ProjectBuildError[];
  typeProblems: ProjectBuildError[];
  warnings: ProjectBuildError[];
  migrations: MigrationOutcome | null;
  functions: DeployOutcome | null;
  previewUrl: string | null;
  liveUrl: string | null;
  domains: string[];
  durationMs: number | null;
};

// ------------------------------------------------------------------ versions

/** Snapshots the working copy if it differs from the latest version; returns the version to build. */
export async function ensureVersion(templateId: string, input: { message?: string; source: VersionSource; authorId?: string; authorName?: string }): Promise<{ versionId: string; changed: boolean; diff: FileDiff | null }> {
  const { data: template } = await Template.get({ id: templateId }).go({ attributes: ["id", "headVersionId"] });
  if (!template) throw new Error("That app doesn't exist.");
  const files = await listFiles(templateId);
  if (template.headVersionId) {
    const head = await getVersionManifest(templateId, template.headVersionId).catch(() => null);
    if (head) {
      const diff = diffManifests(head.files, files);
      if (!diff.added.length && !diff.removed.length && !diff.changed.length) return { versionId: template.headVersionId, changed: false, diff };
      const { versionId } = await snapshotVersion(templateId, { message: input.message || describeDiff(diff), source: input.source, authorId: input.authorId, authorName: input.authorName });
      return { versionId, changed: true, diff };
    }
  }
  const { versionId } = await snapshotVersion(templateId, { message: input.message || "Update", source: input.source, authorId: input.authorId, authorName: input.authorName });
  return { versionId, changed: true, diff: null };
}

export function describeDiff(diff: FileDiff): string {
  const parts: string[] = [];
  const name = (p: string) => p.split("/").pop();
  const list = (paths: string[]) => `${paths.slice(0, 3).map(name).join(", ")}${paths.length > 3 ? ` +${paths.length - 3}` : ""}`;
  if (diff.changed.length) parts.push(`edited ${list(diff.changed)}`);
  if (diff.added.length) parts.push(`added ${list(diff.added)}`);
  if (diff.removed.length) parts.push(`removed ${list(diff.removed)}`);
  const text = parts.join("; ");
  return text ? text[0].toUpperCase() + text.slice(1) : "Update";
}

async function appTemplate(templateId: string) {
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.sourceType !== "REACT_PROJECT") throw new Error("That isn't an app project.");
  return template;
}

// ------------------------------------------------------------------ start

export async function startPreview(templateId: string, actor: Actor, opts: { message?: string; source?: VersionSource } = {}): Promise<ProjectBuildItem> {
  const template = await appTemplate(templateId);
  await upgradeAppClient(templateId, actor.userId).catch((err) => console.warn("[apps] client upgrade skipped:", err));
  const { versionId } = await ensureVersion(templateId, { message: opts.message, source: opts.source ?? "editor", authorId: actor.userId, authorName: actor.userName });
  return startBuild({ templateId, organizationId: template.organizationId, versionId, requestedBy: actor.userId, mode: "preview" });
}

export async function startPublish(templateId: string, actor: Actor, opts: { subdomain?: string } = {}): Promise<ProjectBuildItem> {
  const template = await appTemplate(templateId);
  await upgradeAppClient(templateId, actor.userId).catch((err) => console.warn("[apps] client upgrade skipped:", err));
  const { versionId } = await ensureVersion(templateId, { message: "Published", source: "editor", authorId: actor.userId, authorName: actor.userName });
  return startBuild({ templateId, organizationId: template.organizationId, versionId, requestedBy: actor.userId, mode: "release", publishSubdomain: opts.subdomain?.trim().toLowerCase() || undefined });
}

// ------------------------------------------------------------------ finish

const CLAIM_STALE_MS = 4 * 60_000;

async function claimPostSteps(build: ProjectBuildItem): Promise<boolean> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  try {
    await ProjectBuild.patch({ id: build.id })
      .set({ postStatus: "RUNNING", postClaimedAt: now })
      .where((a, op) => `(${op.notExists(a.postStatus)} OR ${op.eq(a.postStatus, "PENDING")} OR (${op.eq(a.postStatus, "RUNNING")} AND ${op.lt(a.postClaimedAt, staleBefore)}))`)
      .go();
    return true;
  } catch (err: any) {
    if (err?.cause?.name === "ConditionalCheckFailedException" || /conditional/i.test(String(err?.message))) return false;
    throw err;
  }
}

async function migrationFilesOf(templateId: string, versionId: string) {
  const manifest = await getVersionManifest(templateId, versionId);
  const sqlFiles = manifest.files.filter((f) => /^db\/migrations\/[^/]+\.sql$/.test(f.path));
  const withContent = await Promise.all(sqlFiles.map(async (f) => ({ path: f.path, content: (await getBlob(templateId, f.sha)).toString("utf8") })));
  return migrationFilesFrom(withContent);
}

/** Runs a successful build's post-build steps (once). Safe to call repeatedly from polls. */
export async function finalizeBuild(build: ProjectBuildItem): Promise<ProjectBuildItem> {
  if (build.status !== "SUCCEEDED" || build.postStatus === "DONE") return build;
  if (!(await claimPostSteps(build))) return (await getBuild(build.id)) ?? build;

  const template = await appTemplate(build.templateId);
  const env = build.mode === "release" ? "live" : "dev";
  let migrationResult: MigrationOutcome | null = null;
  let functionResult: DeployOutcome | null = null;
  let publishResult: { liveUrl: string | null; domains: string[]; switched: boolean; error?: string } | null = null;
  try {
    const files = await migrationFilesOf(build.templateId, build.versionId);
    migrationResult = files.length ? await applyMigrations({ templateId: build.templateId, organizationId: template.organizationId, env, files }) : null;
    if (migrationResult?.applied.length) forgetSchemaVersion(databaseName(build.templateId, env));

    // A failed live migration means the new code may not match the live database: keep the
    // current live version serving rather than switch to something broken.
    if (!migrationResult?.failed) {
      const bundles = (build.functionBundles ?? {}) as Record<string, FunctionBundle>;
      functionResult = await deployFunctions({ templateId: build.templateId, organizationId: template.organizationId, env, buildId: build.id, bundles }).catch((err) => ({
        deployed: [],
        removed: [],
        failed: [{ name: "*", message: err instanceof Error ? err.message : String(err) }],
      }));
    }

    if (build.mode === "release") {
      if (migrationResult?.failed) {
        publishResult = { liveUrl: null, domains: [], switched: false, error: `The database change ${migrationResult.failed.name} failed, so the live app wasn't changed.` };
      } else {
        await Template.patch({ id: build.templateId }).set({ liveBuildId: build.id }).go();
        forgetAppContext(build.templateId);
        try {
          const domains = await ensureDomain(build.templateId, template.name, build.requestedBy ?? template.userId, template.organizationId, build.publishSubdomain);
          publishResult = { liveUrl: domains[0] ? `https://${domains[0]}` : null, domains, switched: true };
        } catch (err) {
          publishResult = { liveUrl: null, domains: [], switched: true, error: err instanceof Error ? err.message : String(err) };
        }
      }
    } else {
      await recordLatestBuild(build);
    }
  } finally {
    await ProjectBuild.patch({ id: build.id })
      .set({ postStatus: "DONE", migrationResult: migrationResult ?? undefined, functionResult: functionResult ?? undefined, publishResult: publishResult ?? undefined })
      .go();
  }
  return { ...build, postStatus: "DONE", migrationResult, functionResult, publishResult };
}

/** An app gets a working address on first publish without the owner having to pick one. */
async function ensureDomain(templateId: string, name: string, userId: string, organizationId: string, requested?: string): Promise<string[]> {
  const { data: existing } = await PublishedDomain.query.primary({ templateId }).go({ pages: "all" });
  // Addresses switched off by the plan (Free keeps one live site) don't count as live.
  const active = existing.filter(isDomainLive).map((d) => d.domain);
  if (active.length && !requested) return active;
  const { data: user } = await User.get({ id: userId }).go();
  const owner = { userId, organizationId, subscriptionPlan: effectivePlan(user), customDomainLimit: user?.customDomainLimit ?? null };
  const base = slugify(name).replace(/-{2,}/g, "-").slice(0, 40) || "app";
  const candidates = requested ? [requested] : [base, `${base}-${Math.random().toString(36).slice(2, 6)}`, `${base}-${Math.random().toString(36).slice(2, 8)}`];
  let lastError: unknown = null;
  for (const domain of candidates) {
    try {
      const { finalDomain } = await linkDomainToTemplate(owner, templateId, domain, domain.includes(".") ? "CUSTOM" : "SUBDOMAIN");
      return [finalDomain, ...active.filter((d) => d !== finalDomain)];
    } catch (err) {
      lastError = err;
      if (requested || !/already registered|reserved/i.test(String((err as Error)?.message))) break;
    }
  }
  if (active.length) return active;
  throw lastError ?? new Error("Couldn't give the app an address.");
}

// ------------------------------------------------------------------ report

export async function buildReport(buildId: string, opts: { finalize?: boolean } = { finalize: true }): Promise<BuildReport | null> {
  let build = await getBuild(buildId);
  if (!build) return null;
  if (opts.finalize !== false) build = await finalizeBuild(build);
  const { data: template } = await Template.get({ id: build.templateId }).go({ attributes: ["previewHost"] });
  return toReport(build, template?.previewHost);
}

export function toReport(build: ProjectBuildItem, previewHost: string | undefined): BuildReport {
  const warnings = (build.warnings ?? []) as ProjectBuildError[];
  const migrations = (build.migrationResult ?? null) as MigrationOutcome | null;
  const functions = (build.functionResult ?? null) as DeployOutcome | null;
  const publish = (build.publishResult ?? null) as { liveUrl: string | null; domains: string[]; switched: boolean; error?: string } | null;
  const postDone = build.status !== "SUCCEEDED" || build.postStatus === "DONE";
  const pending = !isFinished(build) || !postDone;
  const problems = [
    migrations?.failed ? `database change ${migrations.failed.name} failed` : null,
    functions?.failed.length ? `${functions.failed.length} function(s) failed to deploy` : null,
    publish?.error ?? null,
  ].filter(Boolean);
  return {
    ok: build.status === "SUCCEEDED" && postDone && !problems.length,
    buildId: build.id,
    versionId: build.versionId,
    mode: build.mode ?? "preview",
    status: build.status,
    pending,
    summary: pending ? (build.status === "SUCCEEDED" ? "Finishing up…" : build.status === "BUILDING" ? "Building…" : "Waiting to build…") : [build.summary ?? build.status, ...problems].join(" · "),
    errors: (build.errors ?? []) as ProjectBuildError[],
    typeProblems: warnings.filter((w) => w.kind === "type"),
    warnings: warnings.filter((w) => w.kind !== "type"),
    migrations,
    functions: functions && (functions.deployed.length || functions.removed.length || functions.failed.length) ? functions : null,
    previewUrl: previewHost ? previewUrl(previewHost) : null,
    liveUrl: publish?.liveUrl ?? null,
    domains: publish?.domains ?? [],
    durationMs: build.durationMs ?? null,
  };
}

/** Waits for a build to finish — including its post-build steps (database changes, server
 * functions, going live) — up to waitMs. Those steps are often run by the build finaliser
 * rather than here; this used to return "Finishing up…" the moment it saw them in progress,
 * and SOL then polled app_build_status over and over, each poll a paid round. */
export async function waitForReport(buildId: string, waitMs: number): Promise<BuildReport> {
  // One budget for the whole wait: the build, then its post-build steps.
  const deadline = Date.now() + waitMs;
  const build = await waitForBuild(buildId, waitMs);
  const { data: template } = await Template.get({ id: build.templateId }).go({ attributes: ["previewHost"] });
  return settle(async () => {
    const latest = (await getBuild(buildId)) ?? build;
    return toReport(isFinished(latest) ? await finalizeBuild(latest) : latest, template?.previewHost);
  }, deadline);
}


// ------------------------------------------------------------------ blocking helpers (SOL)

export async function buildPreview(templateId: string, actor: Actor, opts: { message?: string; source?: VersionSource; waitMs?: number } = {}): Promise<BuildReport> {
  const build = await startPreview(templateId, actor, opts);
  return waitForReport(build.id, opts.waitMs ?? 4 * 60_000);
}

export async function publishApp(templateId: string, actor: Actor, opts: { subdomain?: string; waitMs?: number } = {}): Promise<BuildReport & { changes: FileDiff | null }> {
  const template = await appTemplate(templateId);
  let changes: FileDiff | null = null;
  const build = await startPublish(templateId, actor, opts);
  if (template.liveBuildId) {
    const { data: live } = await ProjectBuild.get({ id: template.liveBuildId }).go();
    if (live) {
      const [before, after] = await Promise.all([getVersionManifest(templateId, live.versionId), getVersionManifest(templateId, build.versionId)]);
      changes = diffManifests(before.files, after.files);
    }
  }
  return { ...(await waitForReport(build.id, opts.waitMs ?? 5 * 60_000)), changes };
}
