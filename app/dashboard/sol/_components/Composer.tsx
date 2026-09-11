"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { AttachmentChip } from "./AttachmentChip";
import { VoiceRecorderButton } from "./VoiceRecorderButton";
import { ModelTierSelector } from "./ModelTierSelector";
import { uploadAndTranscribe } from "./transcribeUpload";
import { classifyAttachmentType, type ChatAttachment, type ModelTier, type PendingAttachment } from "./types";

const ACCEPTED_FILE_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,text/markdown,audio/*";

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function Composer({
  streaming,
  disabled,
  modelTier,
  onModelTierChange,
  onSend,
  onStop,
  initialText,
}: {
  streaming: boolean;
  disabled?: boolean;
  modelTier: ModelTier;
  onModelTierChange: (tier: ModelTier) => void;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [transcribingFile, setTranscribingFile] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialText !== undefined) setText(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  async function uploadAttachment(clientId: string, file: File) {
    try {
      const presignRes = await fetch("/api/v1/sol/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
      });
      const presignData = (await presignRes.json().catch(() => ({}))) as { attachmentId?: string; url?: string; fields?: Record<string, string>; publicUrl?: string; error?: string };
      if (!presignRes.ok || !presignData.url || !presignData.fields || !presignData.publicUrl) {
        throw new Error(presignData.error || "Upload failed.");
      }

      const formData = new FormData();
      for (const [key, value] of Object.entries(presignData.fields)) formData.append(key, value);
      formData.append("file", file);
      const uploadRes = await fetch(presignData.url, { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed.");

      setAttachments((prev) =>
        prev.map((a) => (a.clientId === clientId ? { ...a, status: "ready", attachmentId: presignData.attachmentId, url: presignData.publicUrl } : a)),
      );
    } catch (err) {
      setAttachments((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, status: "error", error: err instanceof Error ? err.message : "Upload failed." } : a)));
    }
  }

  async function handleFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      if (file.type.startsWith("audio/")) {
        // An audio file picked directly (rather than recorded) has no representation as a
        // chat content block — same treatment as a recorded voice note: transcribe it and
        // drop the text into the composer instead of attaching it.
        setTranscribingFile(true);
        try {
          const transcript = await uploadAndTranscribe(file, file.name, file.type);
          setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        } catch {
          // Best-effort — a failed voice-file transcription just means nothing gets added.
        } finally {
          setTranscribingFile(false);
        }
        continue;
      }
      const clientId = randomId();
      setAttachments((prev) => [...prev, { clientId, file, status: "uploading" }]);
      void uploadAttachment(clientId, file);
    }
  }

  function removeAttachment(clientId: string) {
    setAttachments((prev) => prev.filter((a) => a.clientId !== clientId));
  }

  function handleSend() {
    const trimmed = text.trim();
    const readyAttachments = attachments.filter((a) => a.status === "ready");
    const stillUploading = attachments.some((a) => a.status === "uploading");
    if ((!trimmed && readyAttachments.length === 0) || stillUploading || streaming || disabled) return;

    const chatAttachments: ChatAttachment[] = readyAttachments.flatMap((a) => {
      const type = classifyAttachmentType(a.file.type);
      return type && a.url ? [{ type, url: a.url, filename: a.file.name } satisfies ChatAttachment] : [];
    });

    onSend(trimmed, chatAttachments);
    setText("");
    setAttachments([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const stillUploading = attachments.some((a) => a.status === "uploading");
  const canSend = (text.trim().length > 0 || attachments.some((a) => a.status === "ready")) && !stillUploading && !disabled;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(18,14,28,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "0.85rem 0.95rem 0.7rem",
        boxShadow: "0 20px 50px -20px rgba(0,0,0,0.55)",
      }}
    >
      {(attachments.length > 0 || transcribingFile) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {attachments.map((a) => (
            <AttachmentChip key={a.clientId} attachment={a} onRemove={() => removeAttachment(a.clientId)} />
          ))}
          {transcribingFile && (
            <div style={{ display: "flex", alignItems: "center", padding: "0.4rem 0.7rem", borderRadius: 10, background: "rgba(255,255,255,0.04)", fontSize: "0.72rem", color: "rgba(240,242,255,0.5)" }}>
              Transcribing audio…
            </div>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message SOL…"
        rows={1}
        disabled={disabled}
        style={{
          width: "100%",
          resize: "none",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#f3f0fa",
          fontSize: "0.92rem",
          lineHeight: 1.5,
          fontFamily: "inherit",
          maxHeight: 220,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILE_TYPES} style={{ display: "none" }} onChange={(e) => { void handleFilesPicked(e.target.files); e.target.value = ""; }} />
          <button
            type="button"
            aria-label="Attach a file"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            style={{ width: 34, height: 34, borderRadius: 9, border: "none", background: "transparent", color: "rgba(240,242,255,0.55)", display: "grid", placeItems: "center", cursor: disabled ? "not-allowed" : "pointer" }}
          >
            <Paperclip size={16} />
          </button>
          <VoiceRecorderButton
            disabled={disabled}
            onTranscribed={(transcript) => {
              if (!transcript) return;
              setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
              textareaRef.current?.focus();
            }}
          />
          <div style={{ width: 148 }}>
            <ModelTierSelector value={modelTier} onChange={onModelTierChange} disabled={disabled || streaming} />
          </div>
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f0f2ff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: "none",
              background: canSend ? "linear-gradient(135deg,#a855f7,#7c3aed)" : "rgba(255,255,255,0.06)",
              color: canSend ? "#fff" : "rgba(240,242,255,0.3)",
              display: "grid",
              placeItems: "center",
              cursor: canSend ? "pointer" : "not-allowed",
              boxShadow: canSend ? "0 8px 24px -6px rgba(168,85,247,0.6)" : "none",
              transition: "background 0.15s, box-shadow 0.15s",
              flexShrink: 0,
            }}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
