import { NextRequest, NextResponse } from "next/server";
import type { EntityItem } from "electrodb";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { PublishedDomain } from "@/lib/db/contentEntities";

/**
 * POST /api/internal/domains/:id/suspend
 * Body: { action: "suspend" | "reinstate", reason?: string }
 *
 * Fast takedown path for an abuse-flagged published domain. Suspending sets
 * PublishedDomain.active=false, which app/pub/[domain] checks before serving any
 * content — visitors get a 403 "unavailable" page instead of the live site, with no
 * need to delete the domain mapping or touch DNS/domain registration.
 *
 * PublishedDomain's real key is (templateId, id) — see contentEntities.ts — not a bare
 * id, so the URL's `:id` alone can't be `.get()`'d directly. Same discipline as
 * lib/safeBrowsing.ts's scanPublishedDomain fix noted in the cutover checklist: this is a
 * genuinely rare, low-frequency admin action (not a hot path), so a bounded Scan to find
 * the row by its bare id is the honest v1 answer rather than adding a byId GSI to the
 * busiest entity in the content table just for this one takedown endpoint.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "reinstate" ? "reinstate" : "suspend";

  type Row = EntityItem<typeof PublishedDomain>;
  let record: Row | undefined;
  let cursor: string | null = null;
  for (;;) {
    const page: { data: Row[]; cursor: string | null } = await PublishedDomain.scan.where(({ id: rowId }, { eq }) => eq(rowId, id)).go({ cursor });
    record = page.data[0];
    if (record) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  if (!record) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  if (action === "suspend") {
    await PublishedDomain.patch({ templateId: record.templateId, id: record.id })
      .set({
        active: false,
        suspendedAt: new Date().toISOString(),
        suspendedReason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "Abuse takedown",
      })
      .go();
  } else {
    await PublishedDomain.patch({ templateId: record.templateId, id: record.id })
      .set({ active: true })
      .remove(["suspendedAt", "suspendedReason"])
      .go();
  }

  const { data: updated } = await PublishedDomain.get({ templateId: record.templateId, id: record.id }).go();

  return NextResponse.json({ success: true, domain: updated });
}
