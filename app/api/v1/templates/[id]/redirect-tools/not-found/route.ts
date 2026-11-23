import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveRedirectAdmin, normalizeRedirectPath } from "@/lib/blog/redirectsDynamo";
import { NotFoundHit } from "@/lib/db/opsEntities";
import { BlogRedirect } from "@/lib/db/contentEntities";

/** GET: the addresses visitors asked for that aren't there (most asked first, ones already redirected left out). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const resolved = await resolveRedirectAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const [{ data: hits }, { data: redirects }] = await Promise.all([
    NotFoundHit.query.primary({ templateId }).go({ limit: 200 }),
    BlogRedirect.query.primary({ templateId }).go({ pages: "all" }),
  ]);
  const have = new Set(redirects.map((r) => r.fromPath));
  const items = hits
    .filter((h) => !have.has(h.path) && (h.ttl ?? Infinity) > Date.now() / 1000)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 50)
    .map((h) => ({ path: h.path, count: h.count ?? 0, lastSeen: h.lastSeen, referrer: h.referrer ?? null }));
  return NextResponse.json({ items });
}

/** DELETE { path }: stop showing one address ("it's fine that this isn't there"). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const resolved = await resolveRedirectAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const permissionError = requirePermission(resolved.context.role, { template: ["update"] });
  if (permissionError) return permissionError;
  const body = await request.json().catch(() => ({}));
  if (typeof body.path !== "string" || !body.path.startsWith("/")) return NextResponse.json({ error: "Which address?" }, { status: 400 });
  await NotFoundHit.delete({ templateId, path: normalizeRedirectPath(body.path) }).go();
  return NextResponse.json({ ok: true });
}
