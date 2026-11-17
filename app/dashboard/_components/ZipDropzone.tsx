"use client";

import { useRef, useState, type DragEvent } from "react";

// "Click to upload, or drag and drop" for one file. Used by the site wizard and the server app panel.

const hairline = "color-mix(in srgb, var(--plx-text, #fff) 9%, transparent)";

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function ZipDropzone({
  file,
  onFile,
  accept = ".zip",
  hint = ".zip",
  disabled = false,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  /** The file input's accept list, e.g. ".html,.htm,.zip". */
  accept?: string;
  /** Shown under the title when no file is chosen, e.g. ".html, .htm, or .zip". */
  hint?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        borderRadius: 14,
        border: `1.5px dashed ${dragActive ? "var(--brand)" : file ? "var(--success)" : hairline}`,
        background: dragActive ? "var(--brand-subtle)" : "color-mix(in srgb, var(--plx-text, #fff) 2%, transparent)",
        padding: "36px 20px",
        textAlign: "center",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <div
        style={{
          width: 44,
          height: 44,
          margin: "0 auto 14px",
          borderRadius: 12,
          background: "var(--brand-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconUpload />
      </div>
      {file ? (
        <>
          <div style={{ fontSize: "13.5px", fontWeight: 650, color: "var(--text-main)" }}>{file.name}</div>
          <div style={{ fontSize: "11.5px", color: "var(--text-faint)", marginTop: 4 }}>
            {(file.size / 1024).toFixed(0)} KB &middot; click or drop to replace
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: "13.5px", fontWeight: 650, color: "var(--text-main)" }}>Click to upload, or drag and drop</div>
          <div style={{ fontSize: "11.5px", color: "var(--text-faint)", marginTop: 4 }}>{hint}</div>
        </>
      )}
    </div>
  );
}
