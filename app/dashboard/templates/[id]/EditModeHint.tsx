"use client";

import { useEffect, useState } from "react";
import { hintWasSeen, modeHint, rememberHint } from "@/lib/editorModes/hintCopy";

/**
 * A calm, dismissible note the first time someone opens an editor that has Design | Code | Text. Shown once per browser, and
 * never in the way: it sits under the toolbar, not over the page.
 */
export function EditModeHint({ pageKey, blocks }: { pageKey: string; blocks?: boolean }) {
  // Starts hidden so a dismissed hint never flashes on load.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    setOpen(!hintWasSeen(storage));
  }, [pageKey]);
  if (!open) return null;
  const hint = modeHint(!!blocks);
  return (
    <div role="region" aria-label="About Design, Code and Text" style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", padding: "0.6rem 1rem", background: "color-mix(in srgb, var(--brand) 8%, transparent)", borderBottom: "1px solid color-mix(in srgb, var(--brand) 20%, transparent)", fontSize: "0.8rem", color: "var(--ed-t-850)" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <strong style={{ display: "block", marginBottom: 2 }}>{hint.title}</strong>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "0.15rem 1.1rem", lineHeight: 1.5 }}>
          {hint.points.map((p) => (
            <li key={p.label}>
              <strong>{p.label}</strong>: {p.text}
            </li>
          ))}
        </ul>
        <span style={{ display: "block", marginTop: 2, color: "var(--ed-t-600)" }}>{hint.footnote}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            rememberHint(window.localStorage);
          } catch {
            // closes for now
          }
          setOpen(false);
        }}
        style={{ padding: "0.35rem 0.8rem", borderRadius: 8, border: "none", background: "var(--brand)", color: "var(--ed-on-brand)", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
      >
        Got it
      </button>
    </div>
  );
}
