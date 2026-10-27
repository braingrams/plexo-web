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
    // A compact row: a small thumbnail on the left; on the right, SOL's one-line description
    // of the image (lib/ai/solImageDescriptions.ts) with the file's name under it. Before a
    // description exists (older images, or the seconds before it arrives) the name leads.
    const title = description ?? name;
    const subtitle = description ? name : "Image";
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={name}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.65rem",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: "0.4rem 0.75rem 0.4rem 0.4rem",
          width: "min(320px, 100%)",
          textDecoration: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={description ?? name} style={{ width: 52, height: 52, flexShrink: 0, objectFit: "cover", borderRadius: 8, display: "block" }} />
        <span style={{ display: "flex", flexDirection: "column", gap: "0.15rem", minWidth: 0 }}>
          <span style={{ fontSize: "0.78rem", lineHeight: 1.35, color: "rgba(240,242,255,0.88)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{title}</span>
          <span style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</span>
        </span>
      </a>
    );
  }

  return (
    <StepCard fill icon={kind === "image" ? ImageIcon : FileText} title={name} subtitle={kind === "image" ? "Image" : "Document"} status="success">
      {url && (
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: "0.72rem", color: "var(--brand)", textDecoration: "none", alignSelf: "flex-start" }}>
          Open file
        </a>
      )}
    </StepCard>
  );
}
