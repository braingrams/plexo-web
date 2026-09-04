import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveRedirectAdmin, normalizeRedirectPath, normalizeRedirectTarget } from "@/lib/blog/redirectsDynamo";
import { BlogRedirect } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";

// fromPath is BlogRedirect's own sort key, and it contains slashes (e.g. "/blog/old-post")
// — a catch-all segment, same shape as app/api/v1/templates/[id]/files/[...path]/route.ts,
// joined back into one path string and re-normalized to the canonical form.
function resolveFromPath(segments: string[]): string {
  return normalizeRedirectPath(decodeURIComponent(segments.join("/")));
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; fromPath: string[] }> },
): Promise<NextResponse> {
  const { id: templateId, fromPath: fromPathSegments } = await context.params;
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

  const fromPath = resolveFromPath(fromPathSegments);

  const { data: existing } = await BlogRedirect.get({ templateId, fromPath }).go();
  if (!existing) return NextResponse.json({ error: "Redirect not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { toPath: rawToPath } = body;
  if (typeof rawToPath !== "string" || !rawToPath.trim()) {
    return NextResponse.json({ error: "toPath is required." }, { status: 400 });
  }

  const toPath = normalizeRedirectTarget(rawToPath.trim());
  if (fromPath === toPath) {
    return NextResponse.json({ error: "A redirect can't point to itself." }, { status: 400 });
  }

  await BlogRedirect.patch({ templateId, fromPath }).set({ toPath }).go();
  const { data: redirect } = await BlogRedirect.get({ templateId, fromPath }).go();

  return NextResponse.json({ redirect });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; fromPath: string[] }> },
): Promise<NextResponse> {
  const { id: templateId, fromPath: fromPathSegments } = await context.params;
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

  const fromPath = resolveFromPath(fromPathSegments);

  const { data: existing } = await BlogRedirect.get({ templateId, fromPath }).go();
  if (!existing) return NextResponse.json({ error: "Redirect not found." }, { status: 404 });

  await BlogRedirect.remove({ templateId, fromPath }).go();
  return NextResponse.json({ deleted: true });
}
