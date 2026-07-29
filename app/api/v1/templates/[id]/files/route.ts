import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isEditableExtension } from "@/server/rawUpload";

export type FileEntry = {
  path: string;
  contentType: string;
  size: number;
  editable: boolean;
  content?: string; // present only for editable (text) files
  url?: string; // present only for non-editable (binary) files — the real public blob URL
};

/**
 * GET /api/v1/templates/:id/files
 *
 * Lists every file belonging to a RAW_UPLOAD template, eagerly fetching text-file
 * content so the dashboard editor (RawFileEditor) can load everything in one round
 * trip. Binary assets (images/fonts) are returned as metadata + their real blob URL
 * only — they're not text-editable, so there's nothing to eager-load them for beyond
 * letting the client-side preview reference the real asset directly.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, userId: resolved.userId },
    include: { assets: true },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const files: FileEntry[] = [
    {
      path: "index.html",
      contentType: "text/html",
      size: Buffer.byteLength(template.compiledHtml, "utf8"),
      editable: true,
      content: template.compiledHtml,
    },
  ];

  await Promise.all(
    template.assets.map(async (asset) => {
      if (isEditableExtension(asset.path)) {
        const res = await fetch(asset.blobUrl);
        const content = res.ok ? await res.text() : "";
        files.push({
          path: asset.path,
          contentType: asset.contentType,
          size: asset.size,
          editable: true,
          content,
        });
      } else {
        files.push({
          path: asset.path,
          contentType: asset.contentType,
          size: asset.size,
          editable: false,
          url: asset.blobUrl,
        });
      }
    })
  );

  files.sort((a, b) => (a.path === "index.html" ? -1 : b.path === "index.html" ? 1 : a.path.localeCompare(b.path)));

  return NextResponse.json({ templateId: template.id, name: template.name, files });
}
