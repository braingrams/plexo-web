"use client";

import { File as FileIcon, Image as ImageIcon, Loader2, TriangleAlert, X } from "lucide-react";
import type { PendingAttachment } from "./types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const isImage = attachment.file.type.startsWith("image/");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.4rem 0.55rem",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${attachment.status === "error" ? "rgba(248,113,113,0.35)" : "rgba(255,255,255,0.08)"}`,
        maxWidth: 220,
      }}
    >
      <span style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(255,255,255,0.05)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        {isImage ? <ImageIcon size={12} color="rgba(240,242,255,0.6)" /> : <FileIcon size={12} color="rgba(240,242,255,0.6)" />}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: "0.74rem", color: "#f0f2ff", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {attachment.file.name}
        </p>
        <p style={{ fontSize: "0.64rem", color: attachment.status === "error" ? "#f87171" : "rgba(240,242,255,0.4)" }}>
          {attachment.status === "uploading" && "Uploading…"}
          {attachment.status === "ready" && formatBytes(attachment.file.size)}
          {attachment.status === "error" && (attachment.error || "Upload failed")}
        </p>
      </div>
      {attachment.status === "uploading" && <Loader2 size={13} color="rgba(240,242,255,0.5)" style={{ animation: "sol-spin 0.9s linear infinite", flexShrink: 0 }} />}
      {attachment.status === "error" && <TriangleAlert size={13} color="#f87171" style={{ flexShrink: 0 }} />}
      <button
        type="button"
        aria-label="Remove attachment"
        onClick={onRemove}
        style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
