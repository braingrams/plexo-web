import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createPresignedUploadPost } from "@/lib/storage";
import { resolveUser } from "@/lib/auth/resolveUser";
import { SolAttachment } from "@/lib/db/solEntities";

// Images, documents, and voice-note audio a user can attach to a SOL chat message. Wider
// than app/api/v1/media/upload/route.ts's image-only allowlist by design — a SOL
// conversation is a general-purpose assistant chat, not a landing-page image picker.
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain", "text/csv", "text/markdown",
]);
// Voice notes: MediaRecorder's actual produced mime type varies by browser (often carries
// a `;codecs=...` parameter, e.g. "audio/webm;codecs=opus") — checked by prefix rather
// than an exact-match set for that reason, unlike the document/image types above which are
// always sent bare.
const ALLOWED_AUDIO_PREFIXES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg", "audio/x-m4a"];

const MAX_SOL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function isAllowedContentType(contentType: string): boolean {
  if (ALLOWED_CONTENT_TYPES.has(contentType)) return true;
  return ALLOWED_AUDIO_PREFIXES.some((prefix) => contentType.startsWith(prefix));
}

/**
 * POST /api/v1/sol/upload
 *
 * Same presigned-POST-direct-to-S3 shape as app/api/v1/lms/funnels/[templateId]/upload/
 * route.ts and app/api/v1/media/upload/route.ts's own "validate, then call the storage
 * helper" structure — but access:"private" (chat attachments aren't public content) and
 * its own SolAttachment row (lib/db/solEntities.ts), not UploadedImage: that entity is
 * image-only and organization-scoped, whereas this covers several content types and is
 * user-scoped. `conversationId` is optional because a voice note can be recorded from the
 * composer before the conversation it'll be sent into even exists yet (a brand-new chat's
 * first message).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    filename?: string;
    contentType?: string;
    sizeBytes?: number;
    conversationId?: string;
  };

  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim();
  if (!filename || !contentType) {
    return NextResponse.json({ error: "`filename` and `contentType` are required." }, { status: 400 });
  }
  if (!isAllowedContentType(contentType)) {
    return NextResponse.json({ error: `Unsupported content type "${contentType}".` }, { status: 400 });
  }
  const sizeBytes = typeof body.sizeBytes === "number" && body.sizeBytes >= 0 ? body.sizeBytes : 0;
  if (sizeBytes > MAX_SOL_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_SOL_ATTACHMENT_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  const id = randomUUID();
  const path = `sol-attachments/${resolved.userId}/${id}-${filename}`;

  let presigned;
  try {
    presigned = await createPresignedUploadPost(path, {
      access: "private",
      contentType,
      maxSizeBytes: MAX_SOL_ATTACHMENT_BYTES,
    });
  } catch (err) {
    console.error("Failed to create presigned SOL upload:", err);
    return NextResponse.json({ error: "Failed to prepare upload." }, { status: 500 });
  }

  // Recorded up front (before the browser has actually POSTed the bytes to S3) — same
  // "the row anchors the client's next step" pattern as SolConversation's create-then-
  // stream flow. There's no webhook/callback from S3's presigned POST to confirm the
  // upload actually landed, so this row can technically outlive a client that requested a
  // presigned POST and never completed it; harmless (an unreferenced row pointing at an
  // object that may not exist), same trade-off every presigned-POST flow in this codebase
  // already accepts.
  await SolAttachment.create({
    id,
    userId: resolved.userId,
    conversationId: body.conversationId?.trim() || undefined,
    url: presigned.publicUrl,
    filename,
    contentType,
    sizeBytes,
  }).go();

  return NextResponse.json({
    attachmentId: id,
    url: presigned.url,
    fields: presigned.fields,
    publicUrl: presigned.publicUrl,
  });
}
