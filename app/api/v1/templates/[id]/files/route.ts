import { NextRequest, NextResponse } from "next/server";
import { put, BlobError } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";
import {
  contentTypeFor,
  isAllowedExtension,
  isEditableExtension,
  starterContentFor,
  MAX_FILE_COUNT,
  MAX_SINGLE_FILE_BYTES,
  RawUploadValidationError,
} from "@/server/rawUpload";

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
    where: { id, organizationId: resolved.organizationId },
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

function normalizeNewFilePath(rawPath: string): string {
  return rawPath.trim().replace(/^\.?\/+/, "");
}

/**
 * POST /api/v1/templates/:id/files
 *
 * Adds a brand-new file to a RAW_UPLOAD template — e.g. a style.css or script.js that
 * didn't come from the original upload — so index.html can <link>/<script> it. This is
 * the one gap the PUT-only [...path] route intentionally leaves open ("doesn't add or
 * remove files"); everything else (extension allowlist, size/count caps, blob storage)
 * mirrors the zip-extraction path in server/rawUpload.ts.
 *
 * Two request shapes:
 *   - multipart/form-data { file, path? } — uploads a real local file (e.g. a .css/.js
 *     the user already wrote); path defaults to the file's own name.
 *   - application/json { path } — creates an empty file with minimal starter content,
 *     for typing a brand-new file straight into the editor.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const { id } = await context.params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: resolved.organizationId },
    include: { assets: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }
  if (template.sourceType !== "RAW_UPLOAD") {
    return NextResponse.json({ error: "This template was not created via raw upload." }, { status: 400 });
  }

  let rawPath: string;
  let buffer: Buffer;
  const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
  if (isMultipart) {
    const form = await request.formData().catch(() => null);
    const uploaded = form?.get("file");
    if (!(uploaded instanceof File)) {
      return NextResponse.json({ error: "Missing required 'file' field." }, { status: 400 });
    }
    rawPath = ((form?.get("path") as string | null) || uploaded.name || "").trim();
    buffer = Buffer.from(await uploaded.arrayBuffer());
  } else {
    const body = await request.json().catch(() => null);
    rawPath = typeof body?.path === "string" ? body.path : "";
    buffer = null as unknown as Buffer; // filled in below once the path is validated
  }

  if (!rawPath) {
    return NextResponse.json({ error: "Missing required 'path' string." }, { status: 400 });
  }
  const path = normalizeNewFilePath(rawPath);
  if (!path || path.includes("..") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }
  if (!isAllowedExtension(path)) {
    return NextResponse.json({
      error: `File type ".${path.split(".").pop()}" isn't allowed. Use .css, .js, or another supported static asset type.`,
    }, { status: 400 });
  }
  if (path.toLowerCase() === "index.html" || template.assets.some((a) => a.path.toLowerCase() === path.toLowerCase())) {
    return NextResponse.json({ error: `"${path}" already exists on this template.` }, { status: 409 });
  }
  if (template.assets.length + 1 >= MAX_FILE_COUNT) {
    return NextResponse.json({ error: `This template already has the maximum of ${MAX_FILE_COUNT} files.` }, { status: 400 });
  }

  if (!isMultipart) {
    buffer = Buffer.from(starterContentFor(path), "utf8");
  }
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    return NextResponse.json({
      error: `File exceeds the ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB per-file limit.`,
    }, { status: 400 });
  }

  const contentType = contentTypeFor(path);
  const localDevToken = process.env.BLOB_READ_WRITE_TOKEN; // see upload-raw/route.ts — OIDC covers real deployments

  let blobUrl: string;
  try {
    const blob = await put(`raw-sites/${template.id}/${path}`, buffer, {
      access: "public",
      contentType,
      ...(localDevToken ? { token: localDevToken } : {}),
    });
    blobUrl = blob.url;
  } catch (err) {
    if (err instanceof BlobError || err instanceof RawUploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }

  const asset = await prisma.templateAsset.create({
    data: { templateId: template.id, path, blobUrl, contentType, size: buffer.byteLength },
  });

  const editable = isEditableExtension(asset.path);
  const file: FileEntry = {
    path: asset.path,
    contentType: asset.contentType,
    size: asset.size,
    editable,
    ...(editable ? { content: buffer.toString("utf8") } : { url: asset.blobUrl }),
  };

  return NextResponse.json({ success: true, file });
}
