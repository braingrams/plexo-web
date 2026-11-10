import { randomUUID } from "node:crypto";

import { mediaFormatFor, transcribeAudio, TranscribeTimeoutError } from "@/lib/ai/transcribeAudio";
import { SolAttachment } from "@/lib/db/solEntities";
import { uploadObject } from "@/lib/storage";
import { downloadWhatsAppMedia, MediaTooLargeError, type InboundMedia } from "./cloudApi";

// Photos, documents and voice notes sent on WhatsApp. They're saved to the same private SOL attachment area the
// dashboard's paperclip uses (so SOL reads them exactly as it reads an uploaded file), and voice notes are
// turned into text first — after that, they're just another message.

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOCUMENT_TYPES: Record<string, "pdf" | "document"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "text/plain": "document",
  "text/csv": "document",
  "text/markdown": "document",
};
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
};

// A voice note is a few seconds to a minute or two; the SOL Lambda has 15 minutes, so be patient.
const VOICE_POLL_BUDGET_MS = 120_000;

export type PreparedMedia =
  | { ok: true; text: string; attachments: Array<{ type: "image" | "pdf" | "document"; url: string; filename: string }>; echo: string | null }
  | { ok: false; reply: string };

export const UNSUPPORTED_MEDIA_TEXT = "I can read text, photos, PDFs, Word documents and voice notes. I can't open that kind of file yet — could you send it another way, or tell me what's in it?";

function safeName(name: string): string {
  return name.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "file";
}

export async function prepareMedia(media: InboundMedia, ctx: { userId: string; conversationId: string; caption: string }): Promise<PreparedMedia> {
  const mime = media.mimeType.split(";")[0].trim().toLowerCase();

  if (media.kind === "audio") {
    const format = mediaFormatFor(mime);
    if (!format) return { ok: false, reply: "I couldn't play that audio format. Could you record it as a voice note, or type it out?" };
    try {
      const { bytes } = await downloadWhatsAppMedia(media.id);
      const { url } = await uploadObject(`sol-voice/${ctx.userId}/${randomUUID()}.${format}`, bytes, { access: "private", contentType: mime });
      const transcript = await transcribeAudio({ mediaFileUri: url, mediaFormat: format, pollBudgetMs: VOICE_POLL_BUDGET_MS, pollIntervalMs: 2000 });
      if (!transcript) return { ok: false, reply: "I couldn't make out any words in that voice note. Could you try again a little closer to the phone, or type it?" };
      return { ok: true, text: transcript, attachments: [], echo: `🎙️ _“${transcript.length > 400 ? `${transcript.slice(0, 397)}…` : transcript}”_` };
    } catch (err) {
      if (err instanceof MediaTooLargeError) return { ok: false, reply: "That voice note is too long for me to listen to. Could you send a shorter one, or type it?" };
      console.error("[whatsapp] voice note failed:", err instanceof TranscribeTimeoutError ? "transcription timed out" : err);
      return { ok: false, reply: "I couldn't listen to that voice note just now. Please try again, or type it." };
    }
  }

  const isImage = media.kind === "image" && IMAGE_TYPES.has(mime);
  const documentKind = media.kind === "document" ? DOCUMENT_TYPES[mime] : undefined;
  if (!isImage && !documentKind) return { ok: false, reply: UNSUPPORTED_MEDIA_TEXT };

  try {
    const { bytes } = await downloadWhatsAppMedia(media.id);
    const id = randomUUID();
    const filename = media.filename?.trim() || `whatsapp-${isImage ? "photo" : "file"}.${EXTENSION[mime] ?? "bin"}`;
    const { url } = await uploadObject(`sol-attachments/${ctx.userId}/${id}-${safeName(filename)}`, bytes, { access: "private", contentType: mime });
    await SolAttachment.create({ id, userId: ctx.userId, conversationId: ctx.conversationId, url, filename, contentType: mime, sizeBytes: bytes.length }).go();
    return { ok: true, text: ctx.caption, attachments: [{ type: isImage ? "image" : documentKind!, url, filename }], echo: null };
  } catch (err) {
    if (err instanceof MediaTooLargeError) return { ok: false, reply: "That file is too large for me to open (the limit is 25 MB). Could you send a smaller one?" };
    console.error("[whatsapp] couldn't fetch an attachment:", err);
    return { ok: false, reply: "I couldn't download that file from WhatsApp. Please try sending it again." };
  }
}
