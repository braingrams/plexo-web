import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadPost } from "@/lib/storage";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveLmsAdmin } from "@/lib/lms/adminAuthDynamo";

// Documents/images only (video is YouTube-embed only, see lib/lms/rules.ts's module
// comment) — same presigned-POST-direct-to-S3 shape as
// app/api/v1/commerce/[templateId]/digital-upload/route.ts, private prefix since access
// must be gated by enrollment, not a one-time download token.
const MAX_LESSON_FILE_BYTES = 50 * 1024 * 1024; // 50MB — generous for a PDF/deck or an image, well under the 500MB digital-product ceiling

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveLmsAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { lms: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { filename?: string; contentType?: string };
  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim() || "application/octet-stream";
  if (!filename) {
    return NextResponse.json({ error: "filename is required." }, { status: 400 });
  }

  const path = `lms-content/${templateId}/${crypto.randomUUID()}-${filename}`;
  const presigned = await createPresignedUploadPost(path, {
    access: "private",
    contentType,
    maxSizeBytes: MAX_LESSON_FILE_BYTES,
  });

  return NextResponse.json(presigned);
}
