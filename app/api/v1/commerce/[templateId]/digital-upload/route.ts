import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadPost } from "@/lib/storage";

import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { requirePermission } from "@/server/requirePermission";

// Course zips/ebooks/videos can be tens-to-hundreds of MB — buffering the whole file
// through a serverless function body (the pattern app/api/v1/media/upload/route.ts uses
// for small images) risks the request-body ceiling and function memory/timeout. This
// route hands back an S3 presigned POST instead, so the browser uploads DIRECTLY to S3
// (see ProductsClient.tsx) and only this small JSON handshake ever touches the Lambda —
// same reason @vercel/blob/client's handleUpload bypassed the server, replaced here with
// S3's own equivalent primitive (lib/storage.ts's createPresignedUploadPost).
//
// Not scoped to a specific product id (unlike the image upload flow) — a digital file is
// attached to a product's form *before* that product necessarily exists yet (the create
// flow saves the product only once the seller clicks Save), so the path is just
// org-scoped with a fresh random id per upload.
const MAX_DIGITAL_FILE_BYTES = 500 * 1024 * 1024; // 500MB

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { filename?: string; contentType?: string };
  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim() || "application/octet-stream";
  if (!filename) {
    return NextResponse.json({ error: "filename is required." }, { status: 400 });
  }

  // access:"private" — never publicly readable, only reachable through the short-lived
  // signed URL app/api/public/commerce/digital/[token]/route.ts mints at delivery time.
  const path = `commerce-digital/${templateId}/${crypto.randomUUID()}-${filename}`;
  const presigned = await createPresignedUploadPost(path, {
    access: "private",
    contentType,
    maxSizeBytes: MAX_DIGITAL_FILE_BYTES,
  });

  return NextResponse.json(presigned);
}
