import { randomUUID } from "node:crypto";
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";

// Voice notes → text with AWS Transcribe's batch API (a short finished clip, not a live stream). Shared by the
// dashboard's mic button (app/api/v1/sol/voice/transcribe — short poll, it runs under serverFn's 30s ceiling) and
// WhatsApp voice notes (lib/whatsapp/media.ts — runs in the SOL Lambda, so it can wait much longer).

export type MediaFormat = "webm" | "mp4" | "mp3" | "wav" | "ogg" | "amr";

const MEDIA_FORMAT_BY_CONTENT_TYPE: Record<string, MediaFormat> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "mp4",
  "audio/m4a": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/amr": "amr",
};

export function mediaFormatFor(contentType: string): MediaFormat | null {
  return MEDIA_FORMAT_BY_CONTENT_TYPE[contentType.split(";")[0].trim().toLowerCase()] ?? null;
}

export class TranscribeTimeoutError extends Error {
  constructor() {
    super("Transcription is taking longer than expected — please try again.");
    this.name = "TranscribeTimeoutError";
  }
}

let client: TranscribeClient | null = null;
function transcribe(): TranscribeClient {
  client ??= new TranscribeClient({ region: process.env.AWS_REGION || "us-east-1" });
  return client;
}

/** Transcribe wants `s3://bucket/key` (or a path-style URL); our stored URLs are virtual-hosted-style. */
export function toS3Uri(url: string): string {
  try {
    const parsed = new URL(url);
    const match = parsed.hostname.match(/^([a-z0-9.-]+)\.s3\.[a-z0-9-]+\.amazonaws\.com$/);
    if (match) return `s3://${match[1]}/${decodeURIComponent(parsed.pathname.replace(/^\//, ""))}`;
  } catch {
    // fall through
  }
  return url;
}

function extractTranscriptText(resultJson: unknown): string {
  const results = (resultJson as { results?: { transcripts?: Array<{ transcript?: string }> } })?.results;
  return results?.transcripts?.[0]?.transcript?.trim() ?? "";
}

export async function transcribeAudio(opts: { mediaFileUri: string; mediaFormat: MediaFormat; languageCode?: string; pollBudgetMs: number; pollIntervalMs?: number }): Promise<string> {
  const jobName = `sol-voice-${randomUUID()}`;
  await transcribe().send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: (opts.languageCode ?? "en-US") as "en-US",
      MediaFormat: opts.mediaFormat as "webm",
      Media: { MediaFileUri: toS3Uri(opts.mediaFileUri) },
    }),
  );

  const interval = opts.pollIntervalMs ?? 1500;
  const deadline = Date.now() + opts.pollBudgetMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const { TranscriptionJob: job } = await transcribe().send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    if (job?.TranscriptionJobStatus === "COMPLETED") {
      const transcriptUri = job.Transcript?.TranscriptFileUri;
      if (!transcriptUri) throw new Error("Transcribe job completed with no transcript URI.");
      const res = await fetch(transcriptUri);
      if (!res.ok) throw new Error(`Failed to fetch transcript result (${res.status}).`);
      return extractTranscriptText(await res.json());
    }
    if (job?.TranscriptionJobStatus === "FAILED") throw new Error(job.FailureReason || "Transcription job failed.");
  }
  throw new TranscribeTimeoutError();
}
