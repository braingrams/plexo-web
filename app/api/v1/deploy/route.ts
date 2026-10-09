import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/db/coreEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireUser, appError, readBody } from "@/lib/projects/appAccess";
import { deploy, filesFromUpload, DeployError } from "@/lib/projects/deploy";
import type { FileWrite } from "@/lib/projects/fileStore";

/**
 * POST /api/v1/deploy — ship a React project (or a ready-built static site) to Plexo.
 * Authorization: Bearer <Plexo API key>.
 *
 * Body (JSON, up to 5 MB — larger projects: POST /api/v1/deploy/uploads first, then pass uploadUrl):
 *   { appId?: string,          // update an existing app; omit to create a new one
 *     name?: string,           // name for a new app
 *     files?: [{ path, content } | { path, base64 }],
 *     uploadUrl?: string,      // a .zip uploaded via /api/v1/deploy/uploads
 *     replace?: boolean,       // default true: files you don't send are removed
 *     publish?: boolean,       // default false: preview only
 *     subdomain?: string,      // first publish: <subdomain>.<pages domain> (auto-picked if omitted)
 *     message?: string }
 *
 * → 202 { appId, buildId, versionId, previewUrl, statusUrl, editorUrl }
 *   Poll statusUrl (GET /api/v1/deploy/<buildId>) until pending is false; it then has the
 *   build errors (if any), previewUrl and — when published — liveUrl.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  try {
    const body = await readBody(request);
    const creating = typeof body.appId !== "string";
    const denied = requirePermission(resolved.role, { template: [creating ? "create" : "update", ...(body.publish ? ["publish"] : [])] });
    if (denied) return denied;
    const files: FileWrite[] = typeof body.uploadUrl === "string" ? await filesFromUpload(resolved.organizationId, body.uploadUrl) : Array.isArray(body.files) ? body.files : [];
    const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["name"] });
    const result = await deploy(
      { userId: resolved.userId, organizationId: resolved.organizationId, subscriptionPlan: resolved.subscriptionPlan, userName: user?.name ?? undefined },
      {
        appId: creating ? undefined : body.appId,
        name: typeof body.name === "string" ? body.name : undefined,
        files,
        replace: body.replace !== false,
        publish: body.publish === true,
        subdomain: typeof body.subdomain === "string" ? body.subdomain : undefined,
        message: typeof body.message === "string" ? body.message : undefined,
      },
    );
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof DeployError) return NextResponse.json({ error: err.message }, { status: err.status });
    return appError(err);
  }
}
