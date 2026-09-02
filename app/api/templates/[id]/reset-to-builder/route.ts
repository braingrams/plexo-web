import { NextRequest, NextResponse } from "next/server";
import { deleteObjects } from "@/lib/storage";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { isValidUuid } from "@/server/slugDynamo";
import { Template, TemplateAsset } from "@/lib/db/contentEntities";

const BLANK_TEMPLATE_SHELL = {
  body: {
    style: {
      background: "#0b0f19",
      padding: "24px",
    },
    rows: [],
  },
};

/**
 * POST /api/templates/:id/reset-to-builder
 *
 * Switches a RAW_UPLOAD page to BUILDER — DESTRUCTIVE, not a conversion: there's no
 * reliable way to turn arbitrary uploaded HTML back into the builder's structured
 * row/column/element JSON, so this discards the uploaded content entirely and starts
 * the page from a blank canvas instead. The client is expected to confirm this with the
 * user before calling it (irreversible: uploaded files + their blobs are deleted).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const { data: existing } = await Template.get({ id }).go();
  if (!existing || existing.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (existing.sourceType === "BUILDER") {
    return NextResponse.json({ error: "This page is already a DnD builder page." }, { status: 400 });
  }

  const { data: assets } = await TemplateAsset.query.primary({ templateId: existing.id }).go();
  await Promise.all(assets.map((a) => TemplateAsset.remove({ templateId: a.templateId, path: a.path }).go()));

  if (assets.length > 0) {
    await deleteObjects(assets.map((a) => a.blobUrl)).catch((err) =>
      console.error("Failed to delete blobs during reset-to-builder (non-fatal):", err)
    );
  }

  await Template.patch({ id: existing.id })
    .set({ sourceType: "BUILDER", designJson: BLANK_TEMPLATE_SHELL, compiledHtml: "" })
    .go();
  const { data: updated } = await Template.get({ id: existing.id }).go();
  if (!updated) throw new Error(`Template ${existing.id} vanished immediately after being updated`);

  return NextResponse.json({ page: { id: updated.id, sourceType: updated.sourceType } });
}
