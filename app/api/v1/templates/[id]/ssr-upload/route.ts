import { NextRequest, NextResponse } from "next/server";
import { guardSsrSettings } from "@/lib/appFunctions/ssrGuard";
import { createProjectUploadPost } from "@/lib/projects/blobStore";
import { SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";
import { newSsrUploadKey } from "@/lib/projects/ssrUpload";

/**
 * POST /api/v1/templates/:id/ssr-upload
 *
 * Step 1 of an SSR upload. Returns a presigned POST policy: the browser sends the zip straight to
 * storage, then calls ssr-deploy with `uploadKey`. Routing the file through this app would hit
 * Lambda's ~6 MB request limit, so an app-routed upload is capped at about 4.5 MB.
 *
 *   POST { filename, size }
 *   → { url, fields, uploadKey }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const filename = typeof body?.filename === "string" ? body.filename : "";
  const size = typeof body?.size === "number" ? body.size : NaN;
  if (!filename.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Only .zip files are accepted. Zip the project folder that contains package.json." }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "Send the zip's size in bytes." }, { status: 400 });
  }
  if (size > SSR_MAX_ZIP_BYTES) {
    return NextResponse.json({ error: `That zip is ${(size / 1024 / 1024).toFixed(1)}MB. The limit is ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB.` }, { status: 400 });
  }

  const uploadKey = newSsrUploadKey(templateId);
  const { url, fields } = await createProjectUploadPost(uploadKey, { contentType: "application/zip", maxBytes: SSR_MAX_ZIP_BYTES });
  return NextResponse.json({ url, fields, uploadKey });
}
