"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Monitor, Tablet, Smartphone, ExternalLink, Loader2 } from "lucide-react";

type DeviceMode = "desktop" | "tablet" | "mobile";

export function TemplatePreviewModal({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceMode>("desktop");

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    fetch(`/api/v1/marketplace/templates/${templateId}/preview`)
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't load preview.");
        return res.json();
      })
      .then((data: { html: string; name: string }) => {
        if (cancelled) return;
        setHtml(data.html);
        setName(data.name);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const deviceWidths: Record<DeviceMode, string> = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-[var(--bg)]/80 backdrop-blur-md flex flex-col p-4 md:p-6 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col flex-1 max-w-7xl mx-auto w-full bg-[var(--bg-1)] border border-[var(--surface-border)] rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Modal Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[var(--bg-2)] border-b border-[var(--surface-border)]">
          {/* Template Info */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-rose-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-xs font-semibold text-[var(--text-muted)]">
              {name ? (
                <>
                  Previewing <strong className="text-[var(--text-main)] font-bold">{name}</strong>
                </>
              ) : (
                "Loading template preview…"
              )}
            </span>
          </div>

          {/* Device Switcher Controls */}
          <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-xl border border-[var(--surface-border)]">
            <button
              type="button"
              onClick={() => setDevice("desktop")}
              title="Desktop View"
              className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
                device === "desktop"
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setDevice("tablet")}
              title="Tablet View"
              className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
                device === "tablet"
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              <Tablet className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setDevice("mobile")}
              title="Mobile View"
              className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
                device === "mobile"
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              <Smartphone className="w-4 h-4" />
            </button>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2">
            <Link
              href={`/marketplace/${templateId}`}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--brand)] text-xs font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Use Template
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--surface)] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewport Frame Container */}
        <div className="flex-1 min-h-0 relative bg-[var(--bg)] flex items-center justify-center p-4 overflow-hidden">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-2 text-rose-400 text-sm">
              <p>{error}</p>
            </div>
          ) : html === null ? (
            <div className="flex flex-col items-center justify-center gap-3 text-[var(--text-muted)] text-sm">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--brand)]" />
              <span>Rendering template preview...</span>
            </div>
          ) : (
            <div
              style={{ width: deviceWidths[device] }}
              className="h-full transition-all duration-300 ease-out bg-white rounded-xl shadow-2xl overflow-hidden border border-[var(--surface-border)]"
            >
              <iframe
                title={`Preview ${name ?? ""}`}
                srcDoc={html}
                sandbox=""
                className="w-full h-full border-none"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
