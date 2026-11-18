"use client";

import { useEffect, useRef, useState } from "react";
import { uploadAndTranscribe } from "./transcribeUpload";
import { prepareImageForModel } from "./prepareImage";
import { classifyAttachmentType, type ChatAttachment, type ModelTier, type PendingAttachment } from "./types";

export const ACCEPTED_FILE_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,text/markdown,audio/*";

export type ComposerProps = {
  streaming: boolean;
  disabled?: boolean;
  modelTier: ModelTier;
  onModelTierChange: (tier: ModelTier) => void;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
  initialText?: string;
  placeholder?: string;
  /** When set, the model choice is fixed and this explains why (shown on hover). */
  tierNote?: string;
};

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

/** Everything the chat box does (typing, attaching, pasting, sending) — shared by the classic and the new look. */
export function useComposer({ streaming, disabled, onSend, initialText }: ComposerProps) {
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

  async function uploadAttachment(clientId: string, original: File) {
    try {
      const file = await prepareImageForModel(original);
      if (file !== original) setAttachments((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, file } : a)));
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

  return { text, setText, attachments, transcribingFile, textareaRef, fileInputRef, handleFilesPicked, handlePaste, removeAttachment, handleSend, handleKeyDown, canSend };
}
