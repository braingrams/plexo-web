import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { guardSsrSettings } from "@/lib/appFunctions/ssrGuard";
import { listSsrVariables } from "@/lib/appFunctions/ssrVariableStore";
import { buildVariablesFor, buildVarsHash } from "@/lib/appFunctions/ssrVariables";
import { getTierFeatures } from "@/lib/subscription";
import { getObject } from "@/lib/projects/blobStore";
import { startSsrBuild, ssrLatestSourceKey, BuildUnavailableError } from "@/lib/projects/builds";
import { inspectSsrSource } from "@/lib/projects/ssrSource";
import { reserveSsrBuild, releaseSsrBuild } from "@/lib/projects/ssrBudget";
import { markBuildQueued } from "@/lib/projects/ssrRebuild";

/**
 * POST /api/v1/templates/:id/ssr-rebuild
 *
 * Queues a preview build from the app's latest uploaded source, without uploading it again. Used
 * after a secret changes: the rebuilt server restarts and reads the current secrets. The build
 * goes to the preview; publish it to apply the change to the live site.
 *
 *   202 → { buildId, status, framework, warnings, message }
 *   409 → no source has been uploaded yet
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });

  const stored = await getObject(ssrLatestSourceKey(templateId));
  if (!stored) {
    return NextResponse.json({ error: "No source has been uploaded for this app yet. Upload the project first." }, { status: 409 });
  }
  const inspected = await inspectSsrSource(stored.body);
  if (!inspected.ok) {
    return NextResponse.json({ error: `The stored source can't be built: ${inspected.error} Upload the project again.` }, { status: 409 });
  }

  const plan = getTierFeatures(resolved.subscriptionPlan);
  const reservation = await reserveSsrBuild({ organizationId: resolved.organizationId, budgetUsd: plan.ssrMonthlyBudgetUsd });
  if (!reservation.ok) {
    return NextResponse.json({
      error: `This month's server build budget is used up ($${reservation.usedUsd.toFixed(2)} of $${reservation.budgetUsd.toFixed(2)} projected). It resets on the first of next month.`,
    }, { status: 429 });
  }

  try {
    const buildVars = buildVariablesFor(await listSsrVariables(templateId), "dev");
    const build = await startSsrBuild({
      templateId,
      organizationId: resolved.organizationId,
      requestedBy: resolved.userId,
      framework: inspected.framework,
      root: inspected.root,
      publicEnv: buildVars,
    });
    await markBuildQueued(templateId, buildVarsHash(buildVars));
    return NextResponse.json(
      {
        buildId: build.id,
        status: build.status,
        framework: inspected.framework,
        warnings: inspected.warnings,
        message: "Rebuild queued from the stored source. Publish the preview when it succeeds to apply the new secrets to the live site.",
      },
      { status: 202 },
    );
  } catch (err) {
    await releaseSsrBuild({ organizationId: resolved.organizationId });
    if (err instanceof BuildUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    throw err;
  }
}
