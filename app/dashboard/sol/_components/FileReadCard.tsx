"use client";

import { FileText, Image as ImageIcon } from "lucide-react";
import { StepCard } from "./StepCard";

/** Status-only card for an attachment SOL is reading (image/document content blocks in a
 * user message) — no confirm/cancel, no result payload, just "here's a file, and here's
 * whether it's an image or a document." */
export function FileReadCard({ kind, url: storedUrl, filename, description }: { kind: "image" | "document"; url?: string; filename?: string; description?: string }) {
  const name = filename || (storedUrl ? storedUrl.split("/").pop() : undefined) || (kind === "image" ? "Image attachment" : "Document attachment");
  // Attachments are private uploads — view them through the owner-checked signed redirect.
  const url = storedUrl ? `/api/v1/sol/attachments/view?url=${encodeURIComponent(storedUrl)}` : undefined;

  if (kind === "image" && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: "0.35rem",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: "0.5rem",
          maxWidth: 220,
          textDecoration: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={description ?? name} style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8, display: "block" }} />
        {/* SOL's one-line caption (lib/ai/solImageDescriptions.ts), then the file's name. */}
        {description && <span style={{ fontSize: "0.74rem", lineHeight: 1.4, color: "rgba(240,242,255,0.78)" }}>{description}</span>}
        <span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      </a>
    );
  }

  return (
    <StepCard icon={kind === "image" ? ImageIcon : FileText} title={name} subtitle={kind === "image" ? "Image" : "Document"} status="success">
      {url && (
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: "0.72rem", color: "var(--brand)", textDecoration: "none", alignSelf: "flex-start" }}>
          Open file
        </a>
      )}
    </StepCard>
  );
}
