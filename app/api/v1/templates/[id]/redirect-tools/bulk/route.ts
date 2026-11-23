import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveRedirectAdmin } from "@/lib/blog/redirectsDynamo";
import { BlogRedirect } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { parseBulkRedirects } from "@/lib/redirects/bulk";

/** POST { text, permanent? }: add many redirects at once from pasted lines. Addresses that already have one are left alone and reported. */
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
  if (typeof body.text !== "string" || !body.text.trim()) return NextResponse.json({ error: "Paste at least one line, like /old-page /new-page." }, { status: 400 });
  const { rows, problems } = parseBulkRedirects(body.text, body.permanent !== false);

  const { data: existing } = await BlogRedirect.query.primary({ templateId }).go({ pages: "all" });
  const have = new Set(existing.map((r) => r.fromPath));
  const fresh = rows.filter((r) => !have.has(r.fromPath));
  const skipped = rows.filter((r) => have.has(r.fromPath)).map((r) => r.fromPath);
  for (let i = 0; i < fresh.length; i += 25) {
    await BlogRedirect.put(fresh.slice(i, i + 25).map((r) => ({ id: randomUUID(), templateId, fromPath: r.fromPath, toPath: r.toPath, permanent: r.permanent }))).go();
  }
  return NextResponse.json({ created: fresh.length, skipped, problems });
}
