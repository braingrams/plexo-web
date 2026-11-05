import { NextRequest, NextResponse } from "next/server";
import { guardSsrSettings } from "@/lib/appFunctions/ssrGuard";
import { getObject, putObject, deletePrefix } from "@/lib/projects/blobStore";
import { SSR_MAX_ZIP_BYTES } from "@/lib/projects/ssrSource";
import { ssrStagingPrefix, ssrAssembledKey } from "@/lib/projects/ssrUpload";

// 3 MB per chunk. API Gateway base64-encodes the body (×4/3), so a chunk stays under Lambda's 6 MB limit.
const CHUNK_BYTES = 3 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(SSR_MAX_ZIP_BYTES / CHUNK_BYTES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * POST /api/v1/templates/:id/ssr-upload/chunk
 *
 * Chunked upload of a server-rendered app's zip. The browser sends the file in pieces through this
 * app, and the app stages them in the project bucket. Nothing is sent from the browser straight to
 * storage. Headers:
 *
 *   Content-Type: application/octet-stream
 *   X-Upload-Session: <uuid>   — the same for every chunk of one upload
 *   X-Chunk-Index:   <0-based>
 *   X-Chunk-Total:   <count>
 *
 * Earlier chunks answer { status: "received" }. The final chunk assembles the zip and answers
 * { status: "assembled", uploadKey }. Pass uploadKey to ssr-deploy to queue the build.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;

  const session = request.headers.get("x-upload-session") ?? "";
  const index = Number(request.headers.get("x-chunk-index"));
  const total = Number(request.headers.get("x-chunk-total"));
  if (
    !UUID.test(session) ||
    !Number.isInteger(index) || !Number.isInteger(total) ||
    total < 1 || total > MAX_CHUNKS || index < 0 || index >= total
  ) {
    return NextResponse.json({ error: "Invalid or missing chunk headers (X-Upload-Session, X-Chunk-Index, X-Chunk-Total)." }, { status: 400 });
  }

  const chunk = Buffer.from(await request.arrayBuffer());
  if (chunk.byteLength === 0) return NextResponse.json({ error: "Chunk body is empty." }, { status: 400 });
  if (chunk.byteLength > CHUNK_BYTES) return NextResponse.json({ error: `Chunk exceeds the ${CHUNK_BYTES / 1024 / 1024} MB limit.` }, { status: 400 });

  const staging = ssrStagingPrefix(templateId, session);
  await putObject(`${staging}${index}`, chunk, "application/octet-stream");
  if (index < total - 1) return NextResponse.json({ status: "received", chunkIndex: index });

  try {
    const parts: Buffer[] = [];
    for (let i = 0; i < total; i++) {
      const part = await getObject(`${staging}${i}`);
      if (!part) return NextResponse.json({ error: "A part of the upload is missing. Upload the zip again." }, { status: 400 });
      parts.push(part.body);
    }
    const zip = Buffer.concat(parts);
    if (zip.byteLength > SSR_MAX_ZIP_BYTES) {
      return NextResponse.json({ error: `Zip exceeds the ${SSR_MAX_ZIP_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
    }
    const uploadKey = ssrAssembledKey(templateId, session);
    await putObject(uploadKey, zip, "application/zip");
    return NextResponse.json({ status: "assembled", uploadKey });
  } finally {
    // Always clear the parts, whether or not assembly succeeded.
    await deletePrefix(staging).catch(() => undefined);
  }
}
