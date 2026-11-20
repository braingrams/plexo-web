import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/db/coreEntities";
import { resolveStrataCaller } from "@/lib/strata/caller";
import { Member } from "@/lib/db/coreEntities";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { readBody, appError } from "@/lib/projects/appAccess";
import { deploy, filesFromUpload, DeployError } from "@/lib/projects/deploy";
import { PlanLimitError, planLimitResponse } from "@/lib/plan/publishGuard";
import { completeOnboardingForStrataPush } from "@/lib/onboarding/strataPush";
import { findAppForStrataProject, linkPushedAppToBrand, linkAppToStrataProject, checkSubdomain, StrataPublishError } from "@/lib/strata/publish";
import type { FileWrite } from "@/lib/projects/fileStore";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/strata/projects/<strata project id>/publish — publishes a Strata prototype's
 * React project to Plexo and gives it a <subdomain>.plexopages address, in one call.
 * Authorization: Bearer <the person's Charisol ID token> — the same Charisol sign-in they use in Strata.
 * (A Plexo session or API key works too.)
 *
 * Body: { files?: [{ path, content } | { path, base64 }], uploadUrl?: string  (a .zip from /api/v1/deploy/uploads),
 *         name?: string, subdomain?: string, publish?: boolean (default true), message?: string }
 *
 * The first call creates the Plexo app; later calls for the same Strata project update it and
 * keep its address. → 202 { appId, created, buildId, previewUrl, statusUrl, editorUrl, brandUrl (the app's Brand page: its brand bible) } — poll
 * statusUrl until pending is false; it then has the build errors (plain text) or the liveUrl.
 * publish:false only builds a preview link.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length > 200) return NextResponse.json({ error: "That Strata project wasn't found.", code: "not_found" }, { status: 404 });
  const resolved = await resolveStrataCaller(request);
  if (!resolved) return NextResponse.json({ error: "Sign in with your Charisol account to publish to Plexo. Your sign-in may have expired — sign in again.", code: "unauthorized" }, { status: 401 });
  if (!(await checkCommerceRateLimit(`strata:publish:${resolved.userId}`, 20))) {
    return NextResponse.json({ error: "That's a lot of publishes in a short time. Wait a few minutes and try again.", code: "rate_limited" }, { status: 429 });
  }
  try {
    const body = await readBody(request);
    const publish = body.publish !== false;
    const existing = await findAppForStrataProject(resolved.organizationId, id);
    if (existing) {
      const denied = requirePermission(resolved.role, { template: ["update", ...(publish ? ["publish"] : [])] });
      if (denied) return denied;
      if (resolved.role !== null) {
        const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
        const scoped = requireTemplateScope(member, existing.id);
        if (scoped) return scoped;
      }
    } else {
      const denied = requirePermission(resolved.role, { template: ["create", ...(publish ? ["publish"] : [])] });
      if (denied) return denied;
    }

    const files: FileWrite[] = typeof body.uploadUrl === "string" ? await filesFromUpload(resolved.organizationId, body.uploadUrl) : Array.isArray(body.files) ? body.files : [];
    if (!files.length) throw new StrataPublishError("Send the prototype's files (or an uploaded zip) to publish.");
    // The address is only (re)chosen on the first publish; later ones keep it.
    const subdomain = publish ? await checkSubdomain(resolved, existing ? undefined : body.subdomain, existing?.id) : undefined;

    const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["name"] });
    const result = await deploy(
      { userId: resolved.userId, organizationId: resolved.organizationId, subscriptionPlan: resolved.subscriptionPlan, userName: user?.name ?? undefined },
      {
        appId: existing?.id,
        name: typeof body.name === "string" ? body.name : undefined,
        files,
        replace: true,
        publish,
        subdomain,
        message: typeof body.message === "string" ? body.message : "Published from Strata",
      },
    );
    if (!existing) await linkAppToStrataProject(result.appId, id);
    // Pushing from Strata means they already have a brand and know what they are building: skip Plexo's onboarding, and put the
    // pushed brand on the app's Brand page (best effort; the Brand page also connects it by itself the first time it is opened).
    await completeOnboardingForStrataPush(resolved.userId);
    await linkPushedAppToBrand({ appId: result.appId, strataProjectId: id, userId: resolved.userId, organizationId: resolved.organizationId });
    const origin = new URL(request.url).origin;
    return NextResponse.json({ ...result, brandUrl: `${origin}/dashboard/sites/${result.appId}?tab=brand`, statusUrl: `${origin}/api/v1/strata/projects/${encodeURIComponent(id)}/publish/${result.buildId}`, created: !existing }, { status: 202 });
  } catch (err) {
    if (err instanceof StrataPublishError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    if (err instanceof PlanLimitError) return planLimitResponse(err);
    if (err instanceof DeployError) return NextResponse.json({ error: err.message }, { status: err.status });
    return appError(err);
  }
}
