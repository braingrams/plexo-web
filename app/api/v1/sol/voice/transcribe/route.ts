import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { uploadObject, StorageError } from "@/lib/storage";
import { SolAttachment } from "@/lib/db/solEntities";
import { mediaFormatFor, transcribeAudio, TranscribeTimeoutError, type MediaFormat } from "@/lib/ai/transcribeAudio";

// APPROACH: AWS Transcribe offers two APIs — the batch StartTranscriptionJob (async: submit
// a job against a file already sitting in S3, then poll for its result) and
// TranscribeStreaming (a live, bidirectional audio stream, `@aws-sdk/client-transcribe-
// streaming`). Streaming is the right tool for a continuously-spoken, real-time captioning
// use case; SOL's voice notes are the opposite — a single short recording (seconds, up to
// ~1 minute) the client already has as one complete file by the time it's sent here. Wiring
// up a streaming session for something that's already a finished, bounded audio blob would
// mean managing a persistent bidirectional connection for no benefit over just submitting
// the whole file at once — so this uses the batch job API, per this task's own direction.
//
// LATENCY TRADE-OFF (explicit, not hidden): a Transcribe batch job's fixed per-job startup
// overhead (queueing/provisioning the job) commonly runs several seconds to low tens of
// seconds *regardless* of how short the audio itself is — it is NOT proportional to a short
// clip's duration the way, say, a local ffmpeg pass would be. This route runs on the main
// Next.js server function (compute-stack.ts's serverFn), which has a hard 30-second
// execution ceiling (see that stack's own comment on why SOL's separate chat Lambda exists
// at all — this exact constraint is why it needed a dedicated 5-minute-timeout function).
// Short-polling here therefore has real, non-theoretical failure modes on an unlucky/busy
// moment: a job that just happens to take longer than this route's own poll budget doesn't
// get more time to finish, it gets a 504 (below). Accepted for now per this task's
// "synchronous batch + short-poll, for simplicity" instruction — a production-grade version
// would move this to an async job (submit here, return a jobId, let the client poll a
// second lightweight endpoint, or push a completion event) instead of holding one HTTP
// request open across the whole job lifecycle.
// Leaves headroom under serverFn's 30s ceiling for the StartTranscriptionJobCommand call,
// the final GetTranscriptionJobCommand round-trip, and fetching+parsing the result JSON.
const POLL_BUDGET_MS = 22_000;

/**
 * POST /api/v1/sol/voice/transcribe
 *
 * Accepts EITHER a reference to an already-uploaded attachment (JSON body
 * `{attachmentId, languageCode?}`, for a voice note recorded through the normal
 * app/api/v1/sol/upload presigned-POST flow) OR raw multipart audio (`multipart/form-data`
 * with a `file` field, for a client that just wants to record-and-transcribe in one step
 * without a separate upload round-trip first) — Transcribe's batch API can only operate on
 * a file already sitting in S3, so the raw-multipart path uploads it there first via the
 * same lib/storage.ts helper every other upload route in this codebase uses. Returns
 * `{text}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  let mediaFileUri: string;
  let mediaFormat: MediaFormat | null;
  let languageCode = "en-US";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const languageOverride = formData.get("languageCode");
    if (typeof languageOverride === "string" && languageOverride.trim()) languageCode = languageOverride.trim();
    if (!file) {
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
    }
    mediaFormat = mediaFormatFor(file.type);
    if (!mediaFormat) {
      return NextResponse.json({ error: `Unsupported audio type "${file.type}".` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const uploaded = await uploadObject(`sol-voice/${resolved.userId}/${randomUUID()}.${mediaFormat}`, buffer, {
        access: "private",
        contentType: file.type,
      });
      mediaFileUri = uploaded.url;
    } catch (err) {
      if (err instanceof StorageError) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
      throw err;
    }
  } else {
    const body = (await request.json().catch(() => ({}))) as { attachmentId?: string; languageCode?: string };
    if (typeof body.languageCode === "string" && body.languageCode.trim()) languageCode = body.languageCode.trim();
    if (!body.attachmentId) {
      return NextResponse.json({ error: "`attachmentId` (or a multipart `file`) is required." }, { status: 400 });
    }

    // SolAttachment's primary key is scoped to userId with createdAt embedded in the sort
    // key (see solEntities.ts) — same "scoped list, find by id, and this doubles as the
    // ownership check" pattern as every other by-id SOL lookup in this task.
    const { data: attachments } = await SolAttachment.query.primary({ userId: resolved.userId }).go({ pages: "all" });
    const attachment = attachments.find((a) => a.id === body.attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }
    mediaFormat = mediaFormatFor(attachment.contentType);
    if (!mediaFormat) {
      return NextResponse.json({ error: `Attachment content type "${attachment.contentType}" is not a transcribable audio format.` }, { status: 400 });
    }
    mediaFileUri = attachment.url;
  }

  try {
    const text = await transcribeAudio({ mediaFileUri, mediaFormat, languageCode, pollBudgetMs: POLL_BUDGET_MS });
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof TranscribeTimeoutError) {
      console.warn("SOL voice transcription timed out within this request's poll budget:", mediaFileUri);
      return NextResponse.json({ error: err.message }, { status: 504 });
    }
    console.error("SOL voice transcription failed:", err);
    return NextResponse.json({ error: "Transcription failed." }, { status: 500 });
  }
}
