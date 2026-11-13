import { ProjectBuild } from "@/lib/db/projectEntities";
import { deleteObject } from "@/lib/projects/blobStore";
import { DeployedApp } from "@/lib/db/appEntities";
import { inspectSsrSource } from "@/lib/projects/ssrSource";
import { startSsrBuild, recentBuilds, ssrBuildSourceKey, BuildUnavailableError } from "@/lib/projects/builds";
import { reserveSsrBuild, releaseSsrBuild } from "@/lib/projects/ssrBudget";
import { markBuildQueued } from "@/lib/projects/ssrRebuild";
import { ssrFunctionName } from "@/lib/appFunctions/ssrNames";
import { listSsrVariables } from "@/lib/appFunctions/ssrVariableStore";
import { buildVariablesFor, buildVarsHash } from "@/lib/appFunctions/ssrVariables";

// Queues an SSR build from a source zip. Shared by the upload and repo routes
// (app/api/v1/templates/[id]/ssr-deploy) and the push webhook (lib/projects/github/ssrPush.ts).
// Checks the zip, reserves the plan's monthly build budget, queues the build, and creates or
// updates the app's DeployedApp record. The caller decides what a failure means for its own state.

export type SsrQueueResult =
  | { ok: true; buildId: string; status: string; framework: string; functionName: string; warnings: string[] }
  | { ok: false; status: number; error: string };

export function budgetExhaustedMessage(usedUsd: number, budgetUsd: number): string {
  return `This month's server build budget is used up ($${usedUsd.toFixed(2)} of $${budgetUsd.toFixed(2)} projected). It resets on the first of next month.`;
}

export async function queueSsrBuildFromZip(input: {
  organizationId: string;
  templateId: string;
  requestedBy?: string;
  budgetUsd: number;
  sourceZip: Uint8Array;
  /** Set when the source is a GitHub commit (see startSsrBuild). */
  sourceCommitSha?: string;
}): Promise<SsrQueueResult> {
  const inspected = await inspectSsrSource(input.sourceZip);
  if (!inspected.ok) return { ok: false, status: 400, error: inspected.error };

  // Reserve this build's projected cost first, so concurrent uploads can't overspend the month.
  const reservation = await reserveSsrBuild({ organizationId: input.organizationId, budgetUsd: input.budgetUsd });
  if (!reservation.ok) return { ok: false, status: 429, error: budgetExhaustedMessage(reservation.usedUsd, reservation.budgetUsd) };

  try {
    // Build-time variables for the preview. The build bakes them in, so publish compares against this.
    const buildVars = buildVariablesFor(await listSsrVariables(input.templateId), "dev");
    const build = await startSsrBuild({
      templateId: input.templateId,
      organizationId: input.organizationId,
      requestedBy: input.requestedBy,
      sourceZip: inspected.source,
      framework: inspected.framework,
      root: inspected.root,
      publicEnv: buildVars,
      sourceCommitSha: input.sourceCommitSha,
    });
    const hash = buildVarsHash(buildVars);
    const { data: existing } = await DeployedApp.get({ templateId: input.templateId }).go();
    if (existing) await markBuildQueued(input.templateId, hash);
    else await DeployedApp.create({ templateId: input.templateId, type: "SSR", previewBuildVarsHash: hash }).go();
    if (input.sourceCommitSha) await cancelOlderQueuedGitBuilds(input.templateId, build.id, input.organizationId).catch((err) => console.error("cancelling older builds failed", err));
    return {
      ok: true,
      buildId: build.id,
      status: build.status,
      framework: inspected.framework,
      functionName: ssrFunctionName(input.templateId, "preview"),
      warnings: inspected.warnings,
    };
  } catch (err) {
    await releaseSsrBuild({ organizationId: input.organizationId });
    if (err instanceof BuildUnavailableError) return { ok: false, status: 503, error: err.message };
    throw err;
  }
}

/** A newer push replaces a commit's build that hasn't started yet: it's cancelled (the build worker
 * skips cancelled builds) and its budget reservation is given back, since it will never run. */
async function cancelOlderQueuedGitBuilds(templateId: string, keepBuildId: string, organizationId: string): Promise<void> {
  const recent = await recentBuilds(templateId, 10);
  for (const build of recent) {
    if (build.id === keepBuildId || build.kind !== "ssr" || !build.sourceCommitSha || build.status !== "QUEUED") continue;
    const cancelled = await ProjectBuild.patch({ id: build.id })
      .set({ status: "CANCELLED", summary: "Replaced by a newer push." })
      .where((attr, op) => op.eq(attr.status, "QUEUED"))
      .go()
      .then(() => true, () => false);
    if (!cancelled) continue;
    await releaseSsrBuild({ organizationId, now: new Date(build.createdAt ?? Date.now()) });
    await deleteObject(ssrBuildSourceKey(templateId, build.id)).catch(() => undefined);
  }
}
