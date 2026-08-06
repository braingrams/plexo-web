import { NextRequest, NextResponse } from "next/server";
import { put, BlobError } from "@vercel/blob";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";

// Featured images and in-post photos routinely run 2-5MB straight out of a phone/camera
// or an unoptimized WordPress media library export — the raw-upload flow's 1MB
// MAX_SINGLE_FILE_BYTES (server/rawUpload.ts) is calibrated for hand-written css/js, not
// photos, so blog images get their own, larger limit.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);

function randomKey(): string {
  return Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const form = await request.formData().catch(() => null);
  const uploaded = form?.get("file");
  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: "Missing required 'file' field." }, { status: 400 });
  }
  if (!ALLOWED_CONTENT_TYPES.has(uploaded.type)) {
    return NextResponse.json({ error: "Unsupported image type. Use JPEG, PNG, GIF, WebP, AVIF, or SVG." }, { status: 400 });
  }
  if (uploaded.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: `Image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  const buffer = Buffer.from(await uploaded.arrayBuffer());
  const extension = uploaded.type.split("/")[1]?.replace("svg+xml", "svg") || "bin";
  const localDevToken = process.env.BLOB_READ_WRITE_TOKEN; // OIDC covers real deployments — see upload-raw/route.ts

  try {
    const blob = await put(`blog-images/${resolved.context.templateId}/${randomKey()}.${extension}`, buffer, {
      access: "public",
      contentType: uploaded.type,
      ...(localDevToken ? { token: localDevToken } : {}),
    });
    return NextResponse.json({ url: blob.url }, { status: 201 });
  } catch (err) {
    if (err instanceof BlobError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
