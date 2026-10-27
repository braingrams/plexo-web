import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveStrataCaller } from "@/lib/strata/caller";
import { appError } from "@/lib/projects/appAccess";
import { createPresignedUploadPost } from "@/lib/storage";

/**
 * POST /api/v1/strata/projects/<id>/publish/uploads — for prototypes too big to send as JSON (over 5 MB).
 * → { url, fields, uploadUrl }. Upload a .zip (up to 100 MB) with a multipart POST to `url` (every field, then the
 * zip as `file`), then call the publish route with { uploadUrl } within an hour.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStrataCaller(request);
  if (!resolved) return NextResponse.json({ error: "Sign in with your Charisol account to continue.", code: "unauthorized" }, { status: 401 });
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
