import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isValidUuid } from "@/server/slug";

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

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const existing = await prisma.template.findFirst({
    where: { id, userId: resolved.userId },
    select: { id: true, sourceType: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (existing.sourceType === "BUILDER") {
    return NextResponse.json({ error: "This page is already a DnD builder page." }, { status: 400 });
  }

  const assets = await prisma.templateAsset.findMany({ where: { templateId: existing.id } });
  await prisma.templateAsset.deleteMany({ where: { templateId: existing.id } });

  if (assets.length > 0) {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    await del(assets.map((a) => a.blobUrl), blobToken ? { token: blobToken } : undefined).catch((err) =>
      console.error("Failed to delete blobs during reset-to-builder (non-fatal):", err)
    );
  }

  const updated = await prisma.template.update({
    where: { id: existing.id },
    data: {
      sourceType: "BUILDER",
      designJson: BLANK_TEMPLATE_SHELL,
      compiledHtml: "",
    },
    select: { id: true, sourceType: true },
  });

  return NextResponse.json({ page: updated });
}
