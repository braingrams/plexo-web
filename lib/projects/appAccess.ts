import { NextResponse, type NextRequest } from "next/server";
import type { EntityItem } from "electrodb";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { Template } from "@/lib/db/contentEntities";
import { Member, User } from "@/lib/db/coreEntities";
import { ProjectFileError } from "./fileStore";
import { ProjectPathError } from "./paths";
import { BuildUnavailableError } from "./builds";
import { ProjectLimitError } from "./createProject";
import { AppDbError, AppDbUnavailableError } from "@/lib/appData/db";
import { SecretError } from "@/lib/appFunctions/secrets";
import { RestError } from "@/lib/appData/rest";

// Shared by every /api/v1/apps/* route: who's calling, may they touch this app, and one
// consistent way of turning a failure into a message an owner can act on.

export type Resolved = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;
export type AppTemplate = EntityItem<typeof Template>;
export type Access = "read" | "update" | "publish" | "delete";

export async function requireUser(request: NextRequest): Promise<Resolved | NextResponse> {
  const resolved = await resolveUser(request);
  return resolved ?? NextResponse.json({ error: "Sign in, or pass an API key (Authorization: Bearer …)." }, { status: 401 });
}

export async function loadApp(request: NextRequest, id: string, access: Access = "read"): Promise<{ resolved: Resolved; app: AppTemplate; actor: { userId: string; organizationId: string; userName?: string } } | NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  const { data: app } = await Template.get({ id }).go();
  if (!app || app.organizationId !== resolved.organizationId || app.sourceType !== "REACT_PROJECT") {
    return NextResponse.json({ error: "App not found." }, { status: 404 });
  }
  if (access !== "read") {
    const denied = requirePermission(resolved.role, { template: [access] });
    if (denied) return denied;
    if (resolved.role !== null) {
      const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
      const scoped = requireTemplateScope(member, id);
      if (scoped) return scoped;
    }
  }
  const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["name"] });
  return { resolved, app, actor: { userId: resolved.userId, organizationId: resolved.organizationId, userName: user?.name ?? undefined } };
}

export function appError(err: unknown): NextResponse {
  if (err instanceof ProjectFileError || err instanceof ProjectPathError || err instanceof SecretError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof ProjectLimitError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof RestError) return NextResponse.json({ error: err.message, hint: err.hint }, { status: err.status });
  if (err instanceof AppDbError) {
    return NextResponse.json({ error: err.error.message, code: err.error.code, hint: err.error.hint, position: err.error.position }, { status: err.error.kind === "resuming" ? 503 : 400 });
  }
  if (err instanceof BuildUnavailableError || err instanceof AppDbUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
  // Anything unexpected is logged in full but never shown as-is: its text is written for
  // engineers (setting names, AWS errors), not for the owner looking at the screen.
  console.error("App API error", err);
  return NextResponse.json({ error: "Something went wrong on our side. Please try again in a moment." }, { status: 500 });
}

export async function readBody(request: NextRequest, maxBytes = 5 * 1024 * 1024): Promise<Record<string, any>> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw new ProjectFileError(`The request is too large (over ${Math.round(maxBytes / 1024 / 1024)} MB). Send fewer files per request.`);
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new ProjectFileError("The request body must be JSON.");
  }
}
