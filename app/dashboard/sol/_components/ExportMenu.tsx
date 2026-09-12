"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileCode, FileText, Loader2 } from "lucide-react";

type ExportFormat = "pdf" | "docx" | "html";

const FORMATS: Array<{ format: ExportFormat; label: string; icon: typeof FileText }> = [
  { format: "pdf", label: "Export as PDF", icon: FileText },
  { format: "docx", label: "Export as DOCX", icon: FileText },
  { format: "html", label: "Export as HTML", icon: FileCode },
];

/**
 * Small format-picker that downloads a SOL conversation (or one message, via `messageId`)
 * as a file. GET .../export returns a real blob with Content-Disposition, not JSON — this
 * fetches it, makes an object URL, clicks a throwaway anchor, then revokes the URL.
 */
export function ExportMenu({
  conversationId,
  messageId,
  label = "Export",
  align = "right",
}: {
  conversationId: string;
  messageId?: string;
  label?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleExport(format: ExportFormat) {
    setBusyFormat(format);
    setError(null);
    try {
      const params = new URLSearchParams({ format });
      if (messageId) params.set("messageId", messageId);
      const res = await fetch(`/api/v1/sol/conversations/${conversationId}/export?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed.");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `sol-conversation.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setOpen(false);
    } catch {
      setError("Couldn't export — please try again.");
    } finally {
      setBusyFormat(null);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          background: "none",
          border: "none",
          color: "rgba(240,242,255,0.45)",
          cursor: "pointer",
          padding: "0.3rem",
          borderRadius: 7,
          fontFamily: "inherit",
        }}
      >
        <Download size={13} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 0.35rem)",
            ...(align === "left" ? { left: 0 } : { right: 0 }),
            zIndex: 30,
            width: 190,
            background: "rgba(13,15,26,0.98)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 12,
            boxShadow: "0 20px 50px -10px rgba(0,0,0,0.6)",
            padding: "0.35rem",
          }}
        >
          {FORMATS.map(({ format, label: fmtLabel, icon: Icon }) => (
            <button
              key={format}
              type="button"
              onClick={() => void handleExport(format)}
              disabled={busyFormat !== null}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.6rem",
                borderRadius: 8,
                background: "none",
                border: "none",
                color: "rgba(240,242,255,0.75)",
                fontSize: "0.78rem",
                fontWeight: 500,
                cursor: busyFormat ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              {busyFormat === format ? <Loader2 size={13} style={{ animation: "sol-spin 0.9s linear infinite" }} /> : <Icon size={13} />}
              {fmtLabel}
            </button>
          ))}
          {error && <p style={{ fontSize: "0.68rem", color: "#f87171", padding: "0.3rem 0.6rem 0.15rem" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
