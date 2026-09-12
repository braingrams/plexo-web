"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import { AttachmentChip } from "./AttachmentChip";
import { VoiceRecorderButton } from "./VoiceRecorderButton";
import { ModelTierSelector } from "./ModelTierSelector";
import { uploadAndTranscribe } from "./transcribeUpload";
import { classifyAttachmentType, type ChatAttachment, type ModelTier, type PendingAttachment } from "./types";

const PLACEHOLDER = "Ask SOL to publish a page…";

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

  /** Lets a screenshot/copied image go straight into the composer as an attachment via
   * Cmd/Ctrl+V, the same way clicking the attach button + picking a file does — reuses
   * handleFilesPicked's exact upload pipeline (presign → upload → AttachmentChip) instead
   * of a separate path, so paste and pick behave identically. Only intercepts the paste
   * when it actually contains image data; a normal text paste falls through untouched. */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    e.preventDefault();
    const dataTransfer = new DataTransfer();
    for (const file of imageFiles) dataTransfer.items.add(file);
    void handleFilesPicked(dataTransfer.files);
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
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(18,14,28,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "0.6rem 0.7rem",
        boxShadow: "0 20px 50px -20px rgba(0,0,0,0.55)",
      }}
    >
      {(attachments.length > 0 || transcribingFile) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", padding: "0.3rem 0.3rem 0" }}>
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

      {/* One row: attach (+), the growing input, the model-tier switcher, voice, then send —
          a single compact toolbar rather than a text area with a separate icon row
          underneath, matching a tighter, more "AI native" composer feel. `alignItems:
          flex-end` keeps every icon pinned to the input's baseline as it grows to multiple
          lines, instead of drifting to the vertical center of a tall textarea. */}
      <div className="sol-composer-row" style={{ display: "flex", alignItems: "flex-end", gap: "0.35rem" }}>
        <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILE_TYPES} style={{ display: "none" }} onChange={(e) => { void handleFilesPicked(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          aria-label="Attach a file"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(240,242,255,0.65)",
            display: "grid",
            placeItems: "center",
            cursor: disabled ? "not-allowed" : "pointer",
            flexShrink: 0,
          }}
        >
          <Plus size={17} />
        </button>

        <textarea
          ref={textareaRef}
          className="sol-composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={PLACEHOLDER}
          rows={1}
          disabled={disabled}
          style={{
            flex: 1,
            minWidth: 0,
            resize: "none",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#f3f0fa",
            fontSize: "0.92rem",
            lineHeight: 1.5,
            fontFamily: "inherit",
            maxHeight: 220,
            padding: "0.5rem 0.2rem",
          }}
        />

        <div style={{ flexShrink: 0 }}>
          <ModelTierSelector
            value={modelTier}
            onChange={onModelTierChange}
            disabled={disabled || streaming}
            className="sol-composer-tier-select"
            menuWidth={260}
          />
        </div>

        <div style={{ marginBottom: "0.1rem", flexShrink: 0 }}>
          <VoiceRecorderButton
            disabled={disabled}
            onTranscribed={(transcript) => {
              if (!transcript) return;
              setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
              textareaRef.current?.focus();
            }}
          />
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="sol-send-btn"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.08)",
              color: "#f0f2ff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="sol-send-btn"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "none",
              background: canSend ? "linear-gradient(135deg,var(--brand-light),var(--brand-deep))" : "rgba(255,255,255,0.06)",
              color: canSend ? "#fff" : "rgba(240,242,255,0.3)",
              display: "grid",
              placeItems: "center",
              cursor: canSend ? "pointer" : "not-allowed",
              boxShadow: canSend ? "0 6px 20px -4px rgba(var(--brand-rgb),0.7)" : "none",
              transition: "transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease",
              flexShrink: 0,
            }}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <style>{`
        .sol-send-btn:hover:not(:disabled) { transform: scale(1.06); }
        .sol-send-btn:active:not(:disabled) { transform: scale(0.94); }
        /* Plain, borderless model-tier switcher inside the composer row — CustomSelect's
           own default trigger has a border/background meant for a standalone dropdown
           sitting on its own; here it's one control among several in a single toolbar row,
           so it should read as flush with the row, not as its own boxed element. */
        .sol-composer-tier-select {
          width: auto !important;
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          padding: 0.4rem 0.5rem !important;
          gap: 0.3rem !important;
          color: rgba(240,242,255,0.6) !important;
          font-size: 0.78rem !important;
        }
        .sol-composer-tier-select:hover { background: rgba(255,255,255,0.05) !important; }
        /* At ~375px, attach+textarea+tier-selector+voice+send in one row squeezes the
           textarea down to ~30-60px wide — not clipped (flex:1/minWidth:0 shrinks safely),
           but close to unusable for actually typing (found by a mobile audit). Wrapping
           the input onto its own full-width line, with the icon controls on the line below,
           fixes that at the cost of one extra line of height. */
        @media (max-width: 480px) {
          .sol-composer-row { flex-wrap: wrap; }
          .sol-composer-input { flex-basis: 100%; order: -1; margin-bottom: 0.3rem; }
        }
      `}</style>
    </div>
  );
}
