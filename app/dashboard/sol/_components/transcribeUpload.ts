// Shared two-step "upload to S3, then run it through Transcribe" flow — used by both
// VoiceRecorderButton (a live MediaRecorder capture) and Composer's attach button (a
// user-picked audio file), since both end up wanting the exact same result: plain
// transcript text to drop into the composer, never auto-sent.
export async function uploadAndTranscribe(
  blob: Blob,
  filename: string,
  contentType: string,
  onPhaseChange?: (phase: "uploading" | "transcribing") => void,
): Promise<string> {
  onPhaseChange?.("uploading");
  const presignRes = await fetch("/api/v1/sol/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, sizeBytes: blob.size }),
  });
  if (!presignRes.ok) {
    const data = (await presignRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Couldn't prepare the upload.");
  }
  const { attachmentId, url, fields } = (await presignRes.json()) as { attachmentId: string; url: string; fields: Record<string, string> };

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  formData.append("file", blob, filename);
  const uploadRes = await fetch(url, { method: "POST", body: formData });
  if (!uploadRes.ok) throw new Error("Upload failed.");

  onPhaseChange?.("transcribing");
  const transcribeRes = await fetch("/api/v1/sol/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attachmentId }),
  });
  const data = (await transcribeRes.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!transcribeRes.ok) throw new Error(data.error || "Transcription failed.");
  return data.text?.trim() ?? "";
}
