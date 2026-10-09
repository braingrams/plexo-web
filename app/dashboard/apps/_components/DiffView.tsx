"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X } from "lucide-react";
import { appsApi, ApiError } from "./api";
import { C, Empty } from "./ui";
import { ensureMonaco, languageFor, EDITOR_THEME } from "./monaco";

// Side-by-side review of what changed between two versions (or a version and the working
// copy): the "Review changes" after an AI turn, and History's "View changes".

type Status = "A" | "M" | "D";
const BADGE: Record<Status, { label: string; color: string }> = {
  A: { label: "Added", color: C.success },
  M: { label: "Changed", color: C.warning },
  D: { label: "Removed", color: C.danger },
};

export function DiffView(props: { appId: string; versionId: string; against: string; title?: string; onClose?: () => void }) {
  const { appId, versionId, against } = props;
  ensureMonaco();
  const [files, setFiles] = useState<Array<{ path: string; status: Status }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<{ before: string; after: string; binary: boolean } | null>(null);
  const [narrow, setNarrow] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(null);
    appsApi
      .diff(appId, versionId, against)
      .then(({ diff }) => {
        if (cancelled) return;
        const list = [
          ...diff.changed.map((path) => ({ path, status: "M" as const })),
          ...diff.added.map((path) => ({ path, status: "A" as const })),
          ...diff.removed.map((path) => ({ path, status: "D" as const })),
        ].sort((a, b) => a.path.localeCompare(b.path));
        setFiles(list);
        setSelected(list[0]?.path ?? null);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load the changes."));
    return () => {
      cancelled = true;
    };
  }, [appId, versionId, against]);

  useEffect(() => {
    if (!selected) return;
    const id = ++request.current;
    setContent(null);
    appsApi
      .diff(appId, versionId, against, selected)
      .then((res) => {
        if (id !== request.current) return;
        const binary = !!res.before?.binary || !!res.after?.binary;
        setContent({ before: res.before?.content ?? "", after: res.after?.content ?? "", binary });
      })
      .catch((err) => id === request.current && setError(err instanceof ApiError ? err.message : "Couldn't load that file."));
  }, [appId, versionId, against, selected]);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const language = useMemo(() => (selected ? languageFor(selected) : "plaintext"), [selected]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.7rem 0.9rem", borderBottom: `1px solid ${C.border}` }}>
        <strong style={{ fontSize: "0.9rem", flex: 1 }}>{props.title ?? "Changes"}</strong>
        {files && <span style={{ fontSize: "0.74rem", color: C.muted }}>{files.length} file{files.length === 1 ? "" : "s"}</span>}
        {props.onClose && (
          <button type="button" aria-label="Close" onClick={props.onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={18} />
          </button>
        )}
      </div>
      {error ? (
        <Empty title="Couldn't show the changes">{error}</Empty>
      ) : !files ? (
        <Empty title="Loading changes…" />
      ) : files.length === 0 ? (
        <Empty title="No file changes">These two versions have the same files.</Empty>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: narrow ? "column" : "row" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: "0.4rem", width: narrow ? "auto" : 260, maxHeight: narrow ? 160 : undefined, overflow: "auto", borderRight: narrow ? "none" : `1px solid ${C.border}`, borderBottom: narrow ? `1px solid ${C.border}` : "none" }}>
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelected(f.path)}
                  aria-current={selected === f.path}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "0.35rem 0.5rem", borderRadius: 7, border: "none", cursor: "pointer", textAlign: "left", background: selected === f.path ? "rgba(255,255,255,0.08)" : "transparent", color: C.text, fontSize: "0.76rem" }}
                >
                  <span title={BADGE[f.status].label} style={{ fontFamily: C.mono, fontWeight: 700, color: BADGE[f.status].color, width: 12 }}>
                    {f.status}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: C.mono }}>{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {!content ? (
              <Empty title="Loading…" />
            ) : content.binary ? (
              <Empty title="This file isn't text">Images and other binary files can't be compared line by line.</Empty>
            ) : (
              <DiffEditor
                key={selected ?? ""}
                original={content.before}
                modified={content.after}
                language={language}
                theme={EDITOR_THEME}
                options={{ readOnly: true, renderSideBySide: !narrow, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
