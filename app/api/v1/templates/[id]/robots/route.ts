import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { getPageTree } from "@/server/slugDynamo";
import { Member } from "@/lib/db/coreEntities";
import { readRobotsConfig, saveRobotsConfig } from "@/lib/seo/robotsStore";

/**
 * GET/PUT /api/v1/templates/[id]/robots   ([id] is the site's home page)
 *
 * The site's robots.txt choice: open to everyone (default), keep a few folders out, or write the file by hand. Checked line by line
 * before it is saved (lib/seo/robots.ts). The file itself is served from the published site at /robots.txt.
 */
async function siteFor(request: NextRequest, id: string) {
  const resolved = await resolveUser(request);
  if (!resolved) return { ok: false, response: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) } as const;
  const tree = await getPageTree(resolved.organizationId, id);
  if (!tree || tree.rootId !== id) return { ok: false, response: NextResponse.json({ error: "Site not found." }, { status: 404 }) } as const;
  return { ok: true, resolved } as const;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const site = await siteFor(request, id);
  if (!site.ok) return site.response;
  return NextResponse.json({ config: await readRobotsConfig(id) });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const site = await siteFor(request, id);
  if (!site.ok) return site.response;
  const { resolved } = site;
  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;
  if (resolved.role !== null) {
    const { data: member } = await Member.get({ organizationId: resolved.organizationId, userId: resolved.userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }
  const body = (await request.json().catch(() => ({}))) as { config?: unknown };
  const saved = await saveRobotsConfig({ organizationId: resolved.organizationId, templateId: id, input: body.config });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
  return NextResponse.json({ config: saved.config, warnings: saved.warnings });
}
