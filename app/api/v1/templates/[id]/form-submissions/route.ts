import { NextRequest, NextResponse } from "next/server";
import { resolveSiteLayoutAdmin } from "@/lib/siteLayoutDynamo";
import { FormSubmission } from "@/lib/db/opsEntities";
import { isLikelySpam } from "@/lib/forms/spamHeuristics";

/** Lists this site's form submissions (newest first, capped at 200 — same bound the
 * dashboard page used before this route existed) with a `likelySpam` flag computed
 * per-submission so the dashboard can show a badge and power "select all likely spam". */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveSiteLayoutAdmin(request, id);
  if ("error" in resolved) return resolved.error;

  const { data: allSubmissions } = await FormSubmission.query.primary({ templateId: resolved.context.templateId }).go({ pages: "all" });
  const submissions = allSubmissions
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 200)
    .map((s) => ({
      id: s.id,
      formName: s.formName ?? "Website Form",
      fields: s.fields as Record<string, string>,
      createdAt: s.createdAt ?? new Date().toISOString(),
      likelySpam: isLikelySpam(s.fields as Record<string, string>),
    }));

  return NextResponse.json({ submissions });
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
