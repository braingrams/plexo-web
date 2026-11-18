import type { EntityItem } from "electrodb";
import { ProjectGitLink } from "@/lib/db/projectEntities";
import { DeployedApp } from "@/lib/db/appEntities";
import { User } from "@/lib/db/coreEntities";
import { effectivePlan } from "@/lib/plan/entitlement";
import { getTierFeatures } from "@/lib/subscription";
import { getBuild, recentBuilds, ssrBuildSourceKey, type ProjectBuildItem } from "@/lib/projects/builds";
import { deleteObject } from "@/lib/projects/blobStore";
import { queueSsrBuildFromZip } from "@/lib/projects/ssrBuildQueue";
import { runSsrControl } from "@/lib/appFunctions/ssrControlRun";
import { downloadRepoZip } from "./archive";
import { GitHubError } from "./client";

// Server apps (SSR) connected to a GitHub branch. A push to that branch builds the pushed commit
// (the zip is downloaded at the push's sha, so the build is exact), and a good build goes live
// unless the link has publishOnPush turned off. Static apps don't use this file: their push
// path is importPush in sync.ts.
//
// Status is written to the app's ProjectGitLink (status, statusMessage), which is what the
// server app's detail page shows. Only the build for the link's current commit writes it, so an
// older build finishing late can't overwrite a newer push's message.

/** A repository a server app was built from: the commit is pinned, so the build is reproducible. */
export type GitSource = {
  installationId: number;
  repoFullName: string;
  repoId: number;
  branch: string;
  sha: string;
};

const short = (sha: string) => sha.slice(0, 7);

type ProjectGitLinkItem = EntityItem<typeof ProjectGitLink>;

export async function gitLinkFor(templateId: string): Promise<ProjectGitLinkItem | null> {
  const { data } = await ProjectGitLink.get({ templateId }).go();
  return data ?? null;
}

/** Sets the link's status. It never creates the link: patching a missing row would leave a partial one. */
async function setLinkStatus(templateId: string, set: { status: "OK" | "ERROR"; statusMessage: string; lastSyncedCommitSha?: string; lastSyncedAt?: string }): Promise<void> {
  if (!(await gitLinkFor(templateId))) return;
  await ProjectGitLink.patch({ templateId }).set(set).go();
}

/** Connects a server app to the repo it was built from (the wizard's repo path). Runs before the build is queued,
 * so the build can write its status; the route removes the link again if the build isn't queued. */
export async function linkSsrRepo(templateId: string, organizationId: string, linkedBy: string, github: GitSource): Promise<void> {
  await ProjectGitLink.put({
    templateId,
    organizationId,
    installationId: github.installationId,
    repoFullName: github.repoFullName,
    repoId: github.repoId,
    branch: github.branch,
    status: "OK",
    statusMessage: `Building commit ${short(github.sha)} from GitHub.`,
    lastSyncedCommitSha: github.sha,
    lastSyncedAt: new Date().toISOString(),
    linkedBy,
    publishOnPush: true,
  }).go();
}

export async function unlinkSsrRepo(templateId: string): Promise<void> {
  await ProjectGitLink.delete({ templateId }).go().catch(() => undefined);
}

/** Handles a push to the linked branch of a server app: the pushed commit is built and, if it
 * builds, published. Never throws; a failure is written to the link's status instead. */
export async function queueSsrPushBuild(link: ProjectGitLinkItem, push: { after: string }): Promise<void> {
  // A branch deletion pushes the all-zero sha: there's nothing to build.
  if (/^0+$/.test(push.after)) return;
  const { templateId } = link;
  const failed = (message: string) =>
    setLinkStatus(templateId, { status: "ERROR", statusMessage: `Commit ${short(push.after)} wasn't built. ${message}`.slice(0, 400)}).catch((err) => console.error("writing the link status failed", err));
  try {
    const owner = link.linkedBy ? (await User.get({ id: link.linkedBy }).go()).data : null;
    if (!owner) {
      await failed("Couldn't check this app's plan. Check the account that linked the repository.");
      return;
    }
    const plan = getTierFeatures(effectivePlan(owner));
    if (!plan.ssrEnabled) {
      await failed("Server apps are part of the Pro plan. Upgrade in Settings → Billing to use them.");
      return;
    }

    // The zip is the pushed commit itself, so the build can't pick up a later push by mistake.
    const sourceZip = await downloadRepoZip(link.installationId, link.repoFullName, push.after);
    await setLinkStatus(templateId, {
      status: "OK",
      statusMessage: `Building commit ${short(push.after)} from GitHub.`,
      lastSyncedCommitSha: push.after,
      lastSyncedAt: new Date().toISOString(),
    });
    const outcome = await queueSsrBuildFromZip({
      organizationId: link.organizationId,
      templateId,
      requestedBy: link.linkedBy,
      budgetUsd: plan.ssrMonthlyBudgetUsd,
      sourceZip,
      sourceCommitSha: push.after,
    });
    if (!outcome.ok) await failed(outcome.error);
  } catch (err) {
    console.error(`queueing the build for a push to app ${templateId} failed`, err);
    await failed(err instanceof GitHubError ? err.message : "Something went wrong queueing the build. Push again to retry.");
  }
}

/** A build for a commit is superseded when a newer server build for the app is queued, running, or
 * already succeeded. Such a build doesn't deploy or publish, so an older build can't replace the newer one.
 * A newer build that failed doesn't count: the older commit is still the newest one that works. */
export async function isSupersededBuild(build: { id: string; templateId: string; createdAt?: string }): Promise<boolean> {
  const recent = await recentBuilds(build.templateId, 10);
  return recent.some(
    (b) => b.id !== build.id && b.kind === "ssr" && (b.status === "QUEUED" || b.status === "BUILDING" || b.status === "SUCCEEDED") && (b.createdAt ?? "") > (build.createdAt ?? ""),
  );
}

/** Whether a commit's successful build should go live now (publish-on-push, on unless turned off for the link). */
export async function publishesOnPush(templateId: string): Promise<boolean> {
  const link = await gitLinkFor(templateId);
  return link?.publishOnPush !== false;
}

/** Publishes the app's latest preview, as the Publish button does. Returns the error, or null when it went live. */
export async function publishPushedPreview(templateId: string): Promise<string | null> {
  await DeployedApp.patch({ templateId }).set({ publishRequestedAt: new Date().toISOString(), publishError: "", publishWarnings: "[]" }).go();
  await runSsrControl({ kind: "publish", templateId });
  const { data: app } = await DeployedApp.get({ templateId }).go({ attributes: ["publishError"] });
  return app?.publishError || null;
}

/** Records how a commit's build ended. Only the build for the link's current commit writes it. */
export async function reportGitBuild(
  templateId: string,
  commitSha: string,
  outcome: { superseded?: boolean; deployError?: string; publishError?: string; live?: boolean },
): Promise<void> {
  const link = await gitLinkFor(templateId);
  if (!link || link.lastSyncedCommitSha !== commitSha) return;
  const name = `Commit ${short(commitSha)}`;
  if (outcome.superseded) return setLinkStatus(templateId, { status: "OK", statusMessage: `${name} was replaced by a newer build before it went out, so it wasn't deployed.` });
  if (outcome.deployError) return setLinkStatus(templateId, { status: "ERROR", statusMessage: `${name} built, but its server didn't deploy: ${outcome.deployError}. The live app is unchanged.`.slice(0, 400) });
  if (outcome.publishError) return setLinkStatus(templateId, { status: "ERROR", statusMessage: `${name} built, but publishing it failed: ${outcome.publishError}. The live app is unchanged.`.slice(0, 400) });
  if (outcome.live) return setLinkStatus(templateId, { status: "OK", statusMessage: `Live from commit ${short(commitSha)}.` });
  return setLinkStatus(templateId, { status: "OK", statusMessage: `Preview built from commit ${short(commitSha)}. Publish it to put it live.` });
}

/** A failed build (the build worker reports it; no finalizer runs for it). */
export async function reportGitBuildFailed(buildId: string): Promise<void> {
  const build: ProjectBuildItem | null = await getBuild(buildId);
  if (!build || build.kind !== "ssr" || !build.sourceCommitSha) return;
  await releaseGitBuildSource(build.templateId, build.id);
  const link = await gitLinkFor(build.templateId);
  if (!link || link.lastSyncedCommitSha !== build.sourceCommitSha) return;
  const summary = build.summary ? ` (${build.summary})` : "";
  await setLinkStatus(build.templateId, { status: "ERROR", statusMessage: `Commit ${short(build.sourceCommitSha)} didn't build${summary}. The live app is unchanged.`.slice(0, 400) });
}

/** Deletes a git build's own copy of its source once the build is finished. Best effort. */
export async function releaseGitBuildSource(templateId: string, buildId: string): Promise<void> {
  await deleteObject(ssrBuildSourceKey(templateId, buildId)).catch(() => undefined);
}
