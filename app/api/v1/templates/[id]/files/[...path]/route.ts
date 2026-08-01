import { NextRequest, NextResponse } from "next/server";
import { put, BlobError } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import {
  isEditableExtension,
  contentTypeFor,
  MAX_SINGLE_FILE_BYTES,
  RawUploadValidationError,
} from "@/server/rawUpload";
import { scanPublishedDomain } from "@/lib/safeBrowsing";

/**
 * PUT /api/v1/templates/:id/files/*path
 *
 * Overwrites the content of one existing file in a RAW_UPLOAD template — the root
 * document (index.html, stored in Template.compiledHtml) or an existing asset (stored
 * in Vercel Blob, overwritten in place at the same URL). This only edits files that
 * already exist from the original upload; it doesn't add or remove files, keeping the
 * same validation surface (extension allowlist, size cap) as the initial upload.
 *
 * Content is NOT sanitized — same as upload, this is unsanitized-by-design static
 * hosting, safe because of origin isolation (server/pagesDomain.ts), not content
 * filtering. See prisma/schema.prisma's TemplateSourceType doc comment.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string; path: string[] }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id, path: pathSegments } = await context.params;
  const filePath = decodeURIComponent(pathSegments.join("/"));

  const template = await prisma.template.findFirst({ where: { id, organizationId: resolved.organizationId } });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const content = body?.content;
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Missing required 'content' string." }, { status: 400 });
  }
  const contentBuffer = Buffer.from(content, "utf8");
  if (contentBuffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    return NextResponse.json({
      error: `File exceeds the ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB per-file limit.`,
    }, { status: 400 });
  }

  if (filePath === "index.html") {
    await prisma.template.update({
      where: { id: template.id },
      data: { compiledHtml: content },
    });
  } else {
    if (!isEditableExtension(filePath)) {
      return NextResponse.json({ error: "This file type isn't text-editable." }, { status: 400 });
    }
    const asset = await prisma.templateAsset.findUnique({
      where: { templateId_path: { templateId: template.id, path: filePath } },
    });
    if (!asset) {
      return NextResponse.json({
        error: "File not found on this template. Editing only supports files already present from the original upload.",
      }, { status: 404 });
    }

    const localDevToken = process.env.BLOB_READ_WRITE_TOKEN; // see app/api/v1/templates/upload-raw/route.ts — OIDC covers real deployments
    const contentType = contentTypeFor(filePath);
    try {
      const blob = await put(`raw-sites/${template.id}/${filePath}`, contentBuffer, {
        access: "public",
        contentType,
        allowOverwrite: true,
        ...(localDevToken ? { token: localDevToken } : {}),
      });
      await prisma.templateAsset.update({
        where: { id: asset.id },
        data: { blobUrl: blob.url, contentType, size: contentBuffer.byteLength },
      });
    } catch (err) {
      if (err instanceof BlobError || err instanceof RawUploadValidationError) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
      throw err;
    }
  }

  // Content changed under this template — re-scan every domain it's currently live on
  // rather than waiting for the next periodic cron pass.
  const linkedDomains = await prisma.publishedDomain.findMany({
    where: { templateId: template.id },
    select: { id: true },
  });
  for (const d of linkedDomains) {
    void scanPublishedDomain(d.id).catch((err) => console.error("Safe Browsing scan failed:", err));
  }

  return NextResponse.json({ success: true, path: filePath, size: contentBuffer.byteLength });
}
