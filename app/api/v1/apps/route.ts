import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireUser, appError, readBody } from "@/lib/projects/appAccess";
import { createProject } from "@/lib/projects/createProject";
import { startPreview } from "@/lib/projects/pipeline";
import { previewUrl } from "@/lib/projects/previewHost";
import type { FileWrite } from "@/lib/projects/fileStore";

/**
 * GET  /api/v1/apps — the organization's React apps.
 * POST /api/v1/apps — create one: { name, files?: [{ path, content | base64 }], build?: true }.
 *   Starts from the Plexo scaffold (files given replace scaffold files at the same path) and
 *   kicks off the first preview build unless build: false.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  const { data } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all", order: "desc" });
  const apps = data
    .filter((t) => t.sourceType === "REACT_PROJECT" && !t.parentId)
    .map((t) => ({ id: t.id, name: t.name, previewUrl: t.previewHost ? previewUrl(t.previewHost) : null, published: !!t.liveBuildId, updatedAt: t.updatedAt }));
  return NextResponse.json({ apps });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  const denied = requirePermission(resolved.role, { template: ["create"] });
  if (denied) return denied;
  try {
    const body = await readBody(request);
    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) return NextResponse.json({ error: "Give the app a name." }, { status: 400 });
    const files = Array.isArray(body.files) ? (body.files as FileWrite[]) : undefined;
    const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["name"] });
    const created = await createProject(
      { userId: resolved.userId, organizationId: resolved.organizationId, subscriptionPlan: resolved.subscriptionPlan, userName: user?.name ?? undefined },
      { name, files, source: files?.length ? "deploy" : "editor" },
    );
    const build = body.build === false ? null : await startPreview(created.templateId, { userId: resolved.userId, organizationId: resolved.organizationId }).catch(() => null);
    return NextResponse.json({ id: created.templateId, versionId: created.versionId, buildId: build?.id ?? null, previewUrl: previewUrl(created.previewHost) }, { status: 201 });
  } catch (err) {
    return appError(err);
  }
}
