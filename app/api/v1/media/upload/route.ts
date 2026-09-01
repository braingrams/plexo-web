import { NextRequest, NextResponse } from "next/server";
import { uploadObject, StorageError } from "@/lib/storage";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../../domains/route";

// Matches app/api/blog/[templateId]/upload-image/route.ts's limits/allowlist — same kind
// of user-facing image upload, no reason for a different ceiling here.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);

function randomKey(): string {
  return Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Unsupported image type. Use JPEG, PNG, GIF, WebP, AVIF, or SVG." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `Image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const userId = resolved.userId;
    const extension = file.type.split("/")[1]?.replace("svg+xml", "svg") || "bin";
    // There is no writable runtime filesystem in Lambda either — S3 (lib/storage.ts) is
    // this app's storage for user media (see the blog/template-asset upload routes) —
    // same pattern here.
    let blob;
    try {
      blob = await uploadObject(`media/${userId}/${randomKey()}.${extension}`, buffer, {
        access: "public",
        contentType: file.type,
      });
    } catch (err) {
      if (err instanceof StorageError) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
      throw err;
    }

    const uploadedImage = await prisma.uploadedImage.create({
      data: {
        userId,
        organizationId: resolved.organizationId,
        name: file.name,
        url: blob.url,
      },
    });

    return NextResponse.json({
      id: uploadedImage.id,
      name: uploadedImage.name,
      url: uploadedImage.url,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
