import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { resolveRedirectAdmin } from "@/lib/blog/redirectsDynamo";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { onTemplateSaved } from "@/lib/siteLayoutDynamo";
import { restoreTemplateVersion } from "@/lib/templateVersions";
import { endOfLocalDay, groupRestoreDays, planSiteRestore, type SiteRevision } from "@/lib/siteRestorePoints";

const MAX_PAGES = 80;

async function loadSite(rootId: string, organizationId: string) {
  const [{ data: root }, kids] = await Promise.all([
    Template.get({ id: rootId }).go(),
    Template.query.byParent({ parentId: rootId }).go({ pages: "all" }).then((r) => r.data).catch(() => []),
  ]);
  const pages = [root, ...kids].filter((t): t is NonNullable<typeof root> => !!t && t.organizationId === organizationId).slice(0, MAX_PAGES);
  const revs: SiteRevision[] = [];
  // Only the id and time of each saved version are read here (not the pages' content), 20 at most per page.
  for (let i = 0; i < pages.length; i += 8) {
    await Promise.all(pages.slice(i, i + 8).map(async (p) => {
      const { data } = await TemplateRevision.query.primary({ templateId: p.id }).go({ attributes: ["id", "templateId", "createdAt"] });
      for (const r of data) revs.push({ pageId: p.id, pageName: p.name || "Untitled page", id: r.id, createdAt: r.createdAt });
    }));
  }
  return { pages, revs };
}

const tzOf = (v: unknown) => (typeof v === "number" && Math.abs(v) <= 14 * 60 ? v : Number(v) || 0);

/** GET ?tz=<minutes>: the days something was published, newest first, with what each day holds. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveRedirectAdmin(request, id);
  if (resolved.error) return resolved.error;
  const { pages, revs } = await loadSite(id, resolved.context.organizationId);
  const tz = tzOf(new URL(request.url).searchParams.get("tz"));
  return NextResponse.json({ days: groupRestoreDays(revs, tz), pageCount: pages.length });
}

/** POST { day: "2026-11-20", tz }: put every page back the way it was at the end of that day. Pages made later are left alone. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveRedirectAdmin(request, id);
  if (resolved.error) return resolved.error;
  const { role, organizationId, userId } = resolved.context;
  const permissionError = requirePermission(role, { template: ["update"] });
  if (permissionError) return permissionError;
  if (role !== null) {
    const { data: member } = await Member.get({ organizationId, userId }).go();
    const scopeError = requireTemplateScope(member, id);
    if (scopeError) return scopeError;
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) return NextResponse.json({ error: "Pick a day to go back to." }, { status: 400 });
  const tz = tzOf(body.tz);
  const { pages, revs } = await loadSite(id, organizationId);
  const plan = planSiteRestore(revs, pages.map((p) => ({ id: p.id, name: p.name || "Untitled page" })), endOfLocalDay(body.day, tz), new Map(pages.map((p) => [p.id, p.activeVersionId])));
  if (body.dryRun === true) return NextResponse.json({ willRestore: plan.restore.map((r) => r.pageName), untouched: plan.untouched });

  for (const r of plan.restore) {
    const { data: full } = await TemplateRevision.query.primary({ templateId: r.pageId }).go({ order: "desc" }).then((x) => ({ data: x.data.find((v) => v.id === r.revisionId) }));
    if (!full) continue;
    await restoreTemplateVersion(r.pageId, full);
    await onTemplateSaved(r.pageId);
  }
  return NextResponse.json({ restored: plan.restore.length, untouched: plan.untouched });
}
