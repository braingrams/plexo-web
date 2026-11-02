import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { processDeployZip, DeployError } from "@/lib/pub/processDeployZip";
import { uploadObject, readObjectAtKey, deleteObjectsAtPaths } from "@/lib/storage";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
// 3 MB per chunk: base64-encoded by Lambda ≈ 4 MB — well under the 6 MB request-payload limit.
const CHUNK_SIZE_LIMIT = 3 * 1024 * 1024;
// 20 chunks × 3 MB = 60 MB ceiling; MAX_ZIP_BYTES enforces the tighter 50 MB limit.
const MAX_CHUNKS = 20;

/**
 * POST /api/v1/templates/:id/deploy/chunk
 *
 * Chunked deploy for build zips that exceed Lambda's ~4.5 MB single-request ceiling.
 * The client splits the zip into ≤3 MB pieces and POSTs each one sequentially with:
 *
 *   Content-Type: application/octet-stream
 *   X-Upload-Session: <uuid>        — client-generated, same for all chunks in one upload
 *   X-Chunk-Index:   <0-based index>
 *   X-Chunk-Total:   <total count>
 *
 * Non-final chunks return { status: "received", chunkIndex }.
 * The final chunk triggers reassembly and returns the same shape as the single-shot route.
 *
 * Chunks are staged at private/deployStaging/{templateId}/{session}/{index} and cleaned up
 * after successful reassembly.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  const uploadSession = request.headers.get("x-upload-session") ?? "";
  const chunkIndex = parseInt(request.headers.get("x-chunk-index") ?? "", 10);
  const chunkTotal = parseInt(request.headers.get("x-chunk-total") ?? "", 10);

  if (
    !uploadSession ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uploadSession) ||
    isNaN(chunkIndex) ||
    isNaN(chunkTotal) ||
    chunkTotal < 1 ||
    chunkTotal > MAX_CHUNKS ||
    chunkIndex < 0 ||
    chunkIndex >= chunkTotal
  ) {
    return NextResponse.json({ error: "Invalid or missing chunk headers (X-Upload-Session, X-Chunk-Index, X-Chunk-Total)." }, { status: 400 });
  }

  const chunkBuf = Buffer.from(await request.arrayBuffer());
  if (chunkBuf.byteLength === 0) {
    return NextResponse.json({ error: "Chunk body is empty." }, { status: 400 });
  }
  if (chunkBuf.byteLength > CHUNK_SIZE_LIMIT) {
    return NextResponse.json({ error: `Chunk exceeds the ${CHUNK_SIZE_LIMIT / 1024 / 1024} MB limit.` }, { status: 400 });
  }

  // Single-chunk fast path — skip S3 staging entirely.
  if (chunkTotal === 1) {
    return finalize(chunkBuf, templateId);
  }

  const stagingBase = `deployStaging/${templateId}/${uploadSession}`;
  await uploadObject(`${stagingBase}/${chunkIndex}`, chunkBuf, {
    access: "private",
    contentType: "application/octet-stream",
  });

  if (chunkIndex < chunkTotal - 1) {
    return NextResponse.json({ status: "received", chunkIndex });
  }

  // Final chunk: read all staged chunks in order and concatenate.
  const stagingPaths = Array.from({ length: chunkTotal }, (_, i) => `${stagingBase}/${i}`);
  const chunks: Buffer[] = [];
  try {
    for (const path of stagingPaths) {
      const { body } = await readObjectAtKey(path, "private");
      chunks.push(body);
    }
  } finally {
    // Always clean up staging — regardless of read errors or what finalize does below.
    // Swallow cleanup failures: the lifecycle rule handles any objects that slip through.
    await deleteObjectsAtPaths(stagingPaths, "private").catch(() => {});
  }

  return finalize(Buffer.concat(chunks), templateId);
}

async function finalize(buffer: Buffer, templateId: string): Promise<NextResponse> {
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: `Zip exceeds the ${MAX_ZIP_BYTES / 1024 / 1024} MB limit.` }, { status: 400 });
  }
  try {
    const result = await processDeployZip(buffer, templateId);
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Deployed ${result.fileCount} file${result.fileCount !== 1 ? "s" : ""} as a ${result.framework} site. Your domain is now serving the new build.`,
    });
  } catch (err) {
    if (err instanceof DeployError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
