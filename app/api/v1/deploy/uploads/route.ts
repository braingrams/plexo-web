import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser, appError } from "@/lib/projects/appAccess";
import { createPresignedUploadPost } from "@/lib/storage";

/**
 * POST /api/v1/deploy/uploads — for projects too big to send as JSON. Returns a one-time
 * upload form for a .zip of the project (up to 100 MB, straight to storage):
 *   → { url, fields, uploadUrl }
 * Upload with a multipart POST to `url` (all `fields`, then the zip as `file`, type
 * application/zip), then call POST /api/v1/deploy with { uploadUrl }.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  try {
    const { url, fields, publicUrl } = await createPresignedUploadPost(`deploy-uploads/${resolved.organizationId}/${randomUUID()}.zip`, {
      access: "private",
      contentType: "application/zip",
      maxSizeBytes: 100 * 1024 * 1024,
    });
    return NextResponse.json({ url, fields, uploadUrl: publicUrl });
  } catch (err) {
    return appError(err);
  }
}
