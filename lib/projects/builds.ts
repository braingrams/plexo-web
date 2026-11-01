import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { EntityItem } from "electrodb";
import { ProjectBuild, type ProjectBuildError } from "@/lib/db/projectEntities";
import { Template } from "@/lib/db/contentEntities";
import { TABLES } from "@/lib/db/client";
import { projectBucket, projectPrefix, versionManifestKey, buildPrefix, buildSitePrefix, buildResultKey, getObject, putObject } from "./blobStore";
import { BUILD_JOB_VERSION, assetBaseFor, type BuildJob } from "./buildJob";

// Queues and tracks builds. Builds run in lambda/project-build, fed by an SQS queue: the
// queue absorbs bursts (a hundred SOL sessions building at once just wait their turn at the
// Lambda's reserved concurrency instead of failing), retries a crashed build, and lets a new
// build of the same project supersede one that hasn't started yet.

export type ProjectBuildItem = EntityItem<typeof ProjectBuild>;

const QUEUED_TIMEOUT_MS = 20 * 60 * 1000;
const BUILDING_TIMEOUT_MS = 16 * 60 * 1000; // the build Lambda's own 15-minute ceiling, plus slack

let sqs: SQSClient | null = null;
function queue(): SQSClient {
  if (!sqs) sqs = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
  return sqs;
}

export class BuildUnavailableError extends Error {}

export async function startBuild(
  input: { templateId: string; organizationId: string; versionId: string; requestedBy?: string; mode?: "preview" | "release"; publishSubdomain?: string },
): Promise<ProjectBuildItem> {
  const queueUrl = process.env.PROJECT_BUILD_QUEUE_URL;
  if (!queueUrl) throw new BuildUnavailableError("App builds aren't available in this environment yet (PROJECT_BUILD_QUEUE_URL isn't set).");

  // A preview build that hasn't started yet is about to be out of date — cancel it rather
  // than spend a build slot on a version nobody will look at. Release builds (publishing)
  // are never cancelled by a newer preview.
  const pending = await recentBuilds(input.templateId, 10);
  await Promise.all(
    pending
      .filter((b) => b.status === "QUEUED" && (b.mode ?? "preview") === "preview" && (input.mode ?? "preview") === "preview")
      .map((b) =>
        ProjectBuild.patch({ id: b.id })
          .set({ status: "CANCELLED", summary: "Replaced by a newer build." })
          .where((attr, op) => op.eq(attr.status, "QUEUED"))
          .go()
          .catch(() => undefined),
      ),
  );

  const id = randomUUID();
  const bucket = projectBucket();
  const job: BuildJob = {
    v: BUILD_JOB_VERSION,
    buildId: id,
    templateId: input.templateId,
    versionId: input.versionId,
    mode: input.mode ?? "preview",
    bucket,
    manifestKey: versionManifestKey(input.templateId, input.versionId),
    blobPrefix: `${projectPrefix(input.templateId)}/blobs`,
    sitePrefix: buildSitePrefix(input.templateId, id),
    functionsPrefix: `${buildPrefix(input.templateId, id)}/functions`,
    resultKey: buildResultKey(input.templateId, id),
    logKey: `${buildPrefix(input.templateId, id)}/log.txt`,
    assetBase: assetBaseFor(id),
    publicEnv: { VITE_PLEXO_BUILD_ID: id },
    buildsTable: TABLES.content,
  };

  const created = await ProjectBuild.create({
    id,
    templateId: input.templateId,
    organizationId: input.organizationId,
    versionId: input.versionId,
    status: "QUEUED",
    mode: job.mode,
    outputPrefix: job.sitePrefix,
    requestedBy: input.requestedBy,
    postStatus: "PENDING",
    publishSubdomain: input.publishSubdomain,
  }).go();

  await queue().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }));
  return created.data;
}

/** Queues a server-rendered (SSR) build: stores the source zip, then enqueues a job the
 * build Lambda runs down its SSR path (lambda/project-build). Finalizing an SSR build deploys
 * the per-customer plexo-ssr-<templateId> function instead of switching a static site live. */
export async function startSsrBuild(input: {
  templateId: string;
  organizationId: string;
  requestedBy?: string;
  sourceZip: Uint8Array;
  framework: NonNullable<BuildJob["ssrFramework"]>;
  root: string;
}): Promise<ProjectBuildItem> {
  const queueUrl = process.env.PROJECT_BUILD_QUEUE_URL;
  if (!queueUrl) throw new BuildUnavailableError("App builds aren't available in this environment yet (PROJECT_BUILD_QUEUE_URL isn't set).");

  const id = randomUUID();
  const bucket = projectBucket();
  const sourceKey = `${buildPrefix(input.templateId, id)}/ssr-source.zip`;
  await putObject(sourceKey, input.sourceZip, "application/zip");

  const job: BuildJob = {
    v: BUILD_JOB_VERSION,
    buildId: id,
    templateId: input.templateId,
    versionId: `ssr-${id}`,
    mode: "preview",
    bucket,
    manifestKey: "",
    blobPrefix: "",
    sitePrefix: buildSitePrefix(input.templateId, id),
    functionsPrefix: `${buildPrefix(input.templateId, id)}/functions`,
    resultKey: buildResultKey(input.templateId, id),
    logKey: `${buildPrefix(input.templateId, id)}/log.txt`,
    assetBase: assetBaseFor(id),
    publicEnv: {},
    buildsTable: TABLES.content,
    kind: "ssr",
    ssrSourceKey: sourceKey,
    ssrFramework: input.framework,
    ssrRoot: input.root,
  };

  const created = await ProjectBuild.create({
    id,
    templateId: input.templateId,
    organizationId: input.organizationId,
    versionId: job.versionId,
    status: "QUEUED",
    mode: "preview",
    kind: "ssr",
    outputPrefix: job.sitePrefix,
    requestedBy: input.requestedBy,
    postStatus: "PENDING",
  }).go();

  await queue().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }));
  return created.data;
}

/** A build, with a stuck one (lost message, crashed Lambda past every retry) settled as
 * failed instead of spinning forever in the UI. */
export async function getBuild(buildId: string): Promise<ProjectBuildItem | null> {
  const { data } = await ProjectBuild.get({ id: buildId }).go();
  if (!data) return null;
  const age = Date.now() - new Date((data.status === "BUILDING" && data.startedAt ? data.startedAt : data.createdAt) ?? Date.now()).getTime();
  if ((data.status === "QUEUED" && age > QUEUED_TIMEOUT_MS) || (data.status === "BUILDING" && age > BUILDING_TIMEOUT_MS)) {
    const errors: ProjectBuildError[] = [{ kind: "build", message: "The build took too long and was stopped. Try building again; if it keeps happening, the project may have a very large dependency." }];
    const finishedAt = new Date().toISOString();
    await ProjectBuild.patch({ id: buildId }).set({ status: "FAILED", errors, summary: "Build timed out.", finishedAt }).go();
    return { ...data, status: "FAILED", errors, summary: "Build timed out.", finishedAt };
  }
  return data;
}

export const isFinished = (b: { status: string }) => b.status === "SUCCEEDED" || b.status === "FAILED" || b.status === "CANCELLED";

/** Polls until the build finishes or `timeoutMs` passes (returns the latest state either way). */
export async function waitForBuild(buildId: string, timeoutMs = 4 * 60 * 1000): Promise<ProjectBuildItem> {
  const deadline = Date.now() + timeoutMs;
  let delay = 750;
  for (;;) {
    const build = await getBuild(buildId);
    if (!build) throw new Error("That build doesn't exist.");
    if (isFinished(build) || Date.now() >= deadline) return build;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 3000);
  }
}

export async function recentBuilds(templateId: string, limit = 20): Promise<ProjectBuildItem[]> {
  const { data } = await ProjectBuild.query.byTemplate({ templateId }).go({ order: "desc", limit });
  return data;
}

export async function latestSuccessfulBuild(templateId: string, mode: "preview" | "release" = "preview"): Promise<ProjectBuildItem | null> {
  const { data } = await ProjectBuild.query.byTemplate({ templateId }).where((attr, op) => `${op.eq(attr.status, "SUCCEEDED")} AND ${op.eq(attr.mode, mode)}`).go({ order: "desc", limit: 1, pages: 5 });
  return data[0] ?? null;
}

/** Points the preview at the newest successful build (only ever forward). */
export async function recordLatestBuild(build: ProjectBuildItem): Promise<void> {
  const { data: template } = await Template.get({ id: build.templateId }).go({ attributes: ["id", "latestBuildId"] });
  if (!template) return;
  if (template.latestBuildId) {
    const { data: current } = await ProjectBuild.get({ id: template.latestBuildId }).go();
    if (current && (current.createdAt ?? "") >= (build.createdAt ?? "")) return;
  }
  await Template.patch({ id: build.templateId }).set({ latestBuildId: build.id }).go();
}

export async function readBuildLog(templateId: string, buildId: string): Promise<string> {
  const log = await getObject(`${buildPrefix(templateId, buildId)}/log.txt`);
  return log ? log.body.toString("utf8") : "";
}

/** Human-readable error list for an AI or a person — file:line, message, the offending line. */
export function formatBuildErrors(errors: ProjectBuildError[] | undefined, max = 20): string {
  if (!errors?.length) return "";
  const lines = errors.slice(0, max).map((e) => {
    const where = e.file ? `${e.file}${e.line ? `:${e.line}${e.column ? `:${e.column}` : ""}` : ""}` : e.kind;
    return `• ${where} — ${e.message}${e.snippet ? `\n    ${e.snippet.trim()}` : ""}`;
  });
  if (errors.length > max) lines.push(`…and ${errors.length - max} more.`);
  return lines.join("\n");
}
