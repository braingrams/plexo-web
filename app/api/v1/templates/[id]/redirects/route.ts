import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveRedirectAdmin, normalizeRedirectPath, normalizeRedirectTarget } from "@/lib/blog/redirectsDynamo";
import { BlogRedirect } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const resolved = await resolveRedirectAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: redirects } = await BlogRedirect.query.primary({ templateId }).go();
  redirects.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return NextResponse.json({ redirects });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const resolved = await resolveRedirectAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { template: ["update"] });
  if (permissionError) return permissionError;

  if (role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.context.organizationId, userId: resolved.context.userId }).go();
    const scopeError = requireTemplateScope(member, templateId);
    if (scopeError) return scopeError;
  }

  const body = await request.json().catch(() => ({}));
  const { fromPath: rawFromPath, toPath: rawToPath } = body;

  if (typeof rawFromPath !== "string" || !rawFromPath.trim().startsWith("/")) {
    return NextResponse.json({ error: "fromPath is required and must start with /." }, { status: 400 });
  }
  if (typeof rawToPath !== "string" || !rawToPath.trim()) {
    return NextResponse.json({ error: "toPath is required." }, { status: 400 });
  }

  const fromPath = normalizeRedirectPath(rawFromPath.trim());
  const toPath = normalizeRedirectTarget(rawToPath.trim());

  if (fromPath === toPath) {
    return NextResponse.json({ error: "A redirect can't point to itself." }, { status: 400 });
  }

  const { data: existing } = await BlogRedirect.get({ templateId, fromPath }).go();
  if (existing) {
    return NextResponse.json({ error: `A redirect from "${fromPath}" already exists.` }, { status: 409 });
  }

  const id = randomUUID();
  await BlogRedirect.create({ id, templateId, fromPath, toPath }).go();
  const { data: redirect } = await BlogRedirect.get({ templateId, fromPath }).go();

  return NextResponse.json({ redirect }, { status: 201 });
}
