import { NextRequest, NextResponse } from "next/server";
import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { FormSubmission } from "@/lib/db/opsEntities";
import { isLikelySpam } from "@/lib/forms/spamHeuristics";
import { paginate, parsePageRequest } from "@/lib/pagination";

/** Lists this site's form submissions, newest first, one page at a time (?page=&pageSize=), with a
 * `likelySpam` flag per submission for the badge. `total` is the real total and `likelySpamIds` covers
 * every page, so "select all likely spam" reaches messages that aren't on the page being viewed. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, id);
  if ("error" in resolved) return resolved.error;

  const { data: allSubmissions } = await FormSubmission.query.primary({ templateId: resolved.context.templateId }).go({ pages: "all" });
  const sorted = allSubmissions
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((s) => ({
      id: s.id,
      formName: s.formName ?? "Website Form",
      fields: s.fields as Record<string, string>,
      createdAt: s.createdAt ?? new Date().toISOString(),
      likelySpam: isLikelySpam(s.fields as Record<string, string>),
    }));
  const { items, total, page, pageSize } = paginate(sorted, parsePageRequest(request.nextUrl.searchParams));

  return NextResponse.json({
    submissions: items,
    total,
    page,
    pageSize,
    likelySpamIds: sorted.filter((s) => s.likelySpam).map((s) => s.id),
  });
}

/** Bulk-deletes submissions by id — the only delete path this entity has ever had (see
 * FormSubmission's own comment: these are permanent by design, no ttl, so nothing expires
 * them on its own). Body: { ids: string[] }. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, id);
  if ("error" in resolved) return resolved.error;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === "string") : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "ids is required." }, { status: 400 });
  }

  const templateId = resolved.context.templateId;
  // ElectroDB needs the full sort-key composite (createdAt + id) to build a delete
  // key, not just id — fetch the matching records first rather than trusting the
  // client to round-trip createdAt values it was never asked to keep.
  const { data: allSubmissions } = await FormSubmission.query.primary({ templateId }).go({ pages: "all" });
  const idSet = new Set(ids);
  const toDelete = allSubmissions.filter((s) => idSet.has(s.id));

  await Promise.all(toDelete.map((s) => FormSubmission.remove({ templateId, id: s.id, createdAt: s.createdAt }).go()));

  return NextResponse.json({ success: true, deleted: toDelete.length });
}
