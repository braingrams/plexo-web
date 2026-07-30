"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import type { FileEntry } from "@/app/api/v1/templates/[id]/files/route";
import { buildPreviewHtml } from "./preview-utils";
import { PagesPanel } from "./PagesPanel";

type Props = {
  templateId: string;
  templateName: string;
  subscriptionPlan: string;
};

function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** CodeMirror's language package picks syntax highlighting/indentation rules per file type;
 * html() already knows how to highlight embedded <style>/<script> blocks, so .html/.htm
 * cover typical raw-upload pages without needing the css/js packages nested manually. */
function getLanguageExtension(path: string) {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "css") return css();
  if (ext === "js" || ext === "mjs" || ext === "cjs") return javascript();
  return html();
}

// Matches the app's dark shell (#0b0f19 background) instead of oneDark's default panel color,
// so the editor doesn't look like a mismatched widget dropped into the page.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#0b0f19", height: "100%" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.85rem", padding: "1.25rem 1.25rem 1.25rem 0" },
    ".cm-gutters": { backgroundColor: "#0b0f19", borderRight: "1px solid rgba(255,255,255,0.06)", color: "rgba(240,242,255,0.25)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.04)" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true }
);

export function RawFileEditor({ templateId, templateName, subscriptionPlan }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedContent, setSavedContent] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState<string>("index.html");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewRootPath, setPreviewRootPath] = useState("index.html");
  const previewCleanupRef = useRef<(() => void) | null>(null);

  const [pendingReplaceFile, setPendingReplaceFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const loadFiles = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return fetch(`/api/v1/templates/${templateId}/files`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load files.");
        return res.json();
      })
      .then((data: { files: FileEntry[] }) => {
        setFiles(data.files);
        const initial: Record<string, string> = {};
        for (const f of data.files) {
          if (f.editable) initial[f.path] = f.content ?? "";
        }
        setEdits(initial);
        setSavedContent(initial);
        setActivePath("index.html");
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load files."))
      .finally(() => setLoading(false));
  }, [templateId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    return () => previewCleanupRef.current?.();
  }, []);

  const activeFile = files.find((f) => f.path === activePath) ?? null;
  const languageExtension = useMemo(
    () => (activeFile ? getLanguageExtension(activeFile.path) : html()),
    [activeFile]
  );
  const isDirty = useCallback(
    (path: string) => edits[path] !== undefined && edits[path] !== savedContent[path],
    [edits, savedContent]
  );
  const anyDirty = files.some((f) => f.editable && isDirty(f.path));

  async function handleSave(path: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`/api/v1/templates/${templateId}/files/${encodedPath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: edits[path] }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Save failed.");

      setSavedContent((prev) => ({ ...prev, [path]: edits[path] }));
      setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, size: payload.size } : f)));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenPreview() {
    previewCleanupRef.current?.();
    // Preview whichever HTML page is currently open — a multi-page raw upload (a zip
    // with about.html, blog/post-1.html, etc. alongside index.html) can have more than
    // one page, and "preview" should reflect the one you're actually looking at, not
    // always the site's root. Non-HTML files (CSS/JS) have no page of their own to
    // preview, so those fall back to index.html.
    const isHtmlFile = activePath.toLowerCase().endsWith(".html") || activePath.toLowerCase().endsWith(".htm");
    const rootPath = isHtmlFile ? activePath : "index.html";
    const { html, cleanup } = buildPreviewHtml(files, edits, rootPath);
    previewCleanupRef.current = cleanup;
    setPreviewHtml(html);
    setPreviewRootPath(rootPath);
    setPreviewOpen(true);
  }

  function handleClosePreview() {
    setPreviewOpen(false);
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
  }

  function handlePickReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // allow picking the same filename again later
    if (file) setPendingReplaceFile(file);
  }

  async function handleConfirmReplace() {
    if (!pendingReplaceFile) return;
    setReplacing(true);
    setReplaceError(null);
    try {
      const form = new FormData();
      form.append("file", pendingReplaceFile);
      const res = await fetch(`/api/v1/templates/${templateId}/replace-upload`, {
        method: "POST",
        body: form,
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Replace failed.");

      setPendingReplaceFile(null);
      await loadFiles();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : "Replace failed.");
    } finally {
      setReplacing(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activePath && isDirty(activePath)) void handleSave(activePath);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath, edits, savedContent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div style={{ padding: "3rem", color: "rgba(240,242,255,0.5)" }}>Loading files…</div>;
  }
  if (loadError) {
    return <div style={{ padding: "3rem", color: "#f87171" }}>{loadError}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0b0f19", color: "#f0f2ff" }}>
      <PagesPanel
        templateId={templateId}
        subscriptionPlan={subscriptionPlan}
        onNavigate={(pageId) => { if (pageId !== templateId) router.push(`/dashboard/templates/${pageId}`); }}
      />
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.85rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <Link href="/dashboard/templates" style={{ color: "rgba(240,242,255,0.4)", textDecoration: "none", fontSize: "0.8rem" }}>
            ← Templates
          </Link>
          <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{templateName}</span>
          <span style={{
            fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
            color: "#818cf8", background: "rgba(99,102,241,0.1)", padding: "0.15rem 0.5rem", borderRadius: 5,
          }}>
            Raw Upload
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {saveError && <span style={{ color: "#f87171", fontSize: "0.78rem" }}>⚠️ {saveError}</span>}
          {savedFlash && <span style={{ color: "#34d399", fontSize: "0.78rem" }}>✓ Saved</span>}
          <input
            ref={replaceInputRef}
            type="file"
            accept=".html,.htm,.zip"
            onChange={handlePickReplaceFile}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => replaceInputRef.current?.click()}
            style={{
              padding: "0.45rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600,
              background: "none", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.8)",
              cursor: "pointer",
            }}
            title="Replace every file on this site with a new .html/.zip upload"
          >
            Replace Files
          </button>
          <button
            type="button"
            onClick={handleOpenPreview}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              padding: "0.45rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600,
              background: "none", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.8)",
              cursor: "pointer",
            }}
            title="Preview exactly as it will be served publicly (includes unsaved edits)"
          >
            <IconEye /> Preview
          </button>
          <button
            type="button"
            disabled={!activePath || !isDirty(activePath) || saving}
            onClick={() => void handleSave(activePath)}
            className="btn-primary"
            style={{
              padding: "0.45rem 1.1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              border: "none", color: "#fff",
              cursor: !activePath || !isDirty(activePath) || saving ? "default" : "pointer",
              opacity: !activePath || !isDirty(activePath) || saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* File list sidebar */}
        <div style={{ width: 220, borderRight: "1px solid rgba(255,255,255,0.08)", overflowY: "auto", flexShrink: 0 }}>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActivePath(f.path)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                padding: "0.6rem 0.9rem", background: f.path === activePath ? "rgba(139,92,246,0.1)" : "none",
                border: "none", borderLeft: f.path === activePath ? "2px solid var(--brand)" : "2px solid transparent",
                color: f.path === activePath ? "#f0f2ff" : "rgba(240,242,255,0.6)",
                fontSize: "0.8rem", textAlign: "left", cursor: "pointer", fontFamily: "monospace",
              }}
              title={`${f.path} — ${formatSize(f.size)}`}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
              {f.editable && isDirty(f.path) && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0, marginLeft: "0.4rem" }} />
              )}
            </button>
          ))}
        </div>

        {/* Editor / binary preview pane */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {!activeFile ? null : activeFile.editable ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <CodeMirror
                value={edits[activeFile.path] ?? ""}
                onChange={(value) => setEdits((prev) => ({ ...prev, [activeFile.path]: value }))}
                extensions={[languageExtension, editorTheme, EditorView.lineWrapping]}
                theme={oneDark}
                basicSetup={{ tabSize: 2 }}
                indentWithTab
                height="100%"
                style={{ flex: 1, minWidth: 0, overflow: "auto" }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", color: "rgba(240,242,255,0.5)" }}>
              {activeFile.contentType.startsWith("image/") && activeFile.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeFile.url} alt={activeFile.path} style={{ maxWidth: "60%", maxHeight: 320, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }} />
              ) : null}
              <p style={{ fontSize: "0.85rem" }}>
                {activeFile.path} — {formatSize(activeFile.size)} — binary file, not text-editable
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.25rem", background: "#12101f", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.7)" }}>
              Previewing <strong style={{ fontFamily: "monospace", color: "#f0f2ff" }}>{previewRootPath}</strong> — reflects unsaved edits, exactly as it will render once published
            </span>
            <button type="button" onClick={handleClosePreview} style={{ background: "none", border: "none", color: "rgba(240,242,255,0.6)", cursor: "pointer" }}>
              <IconClose />
            </button>
          </div>
          <iframe
            title="Live preview"
            srcDoc={previewHtml}
            // Deliberately allow-scripts WITHOUT allow-same-origin: the previewed page
            // is unsanitized, user-authored content. Omitting allow-same-origin forces
            // this iframe into a unique opaque origin, so any script it runs cannot
            // reach this dashboard's cookies, session, or DOM — same isolation
            // principle as the public plexopages.io serving path, applied here so the
            // preview can't become a way to attack the admin's own session.
            sandbox="allow-scripts"
            style={{ flex: 1, border: "none", background: "#fff" }}
          />
        </div>
      )}

      {/* Replace-files confirmation */}
      {pendingReplaceFile && (
        <>
          <div
            onClick={() => !replacing && setPendingReplaceFile(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000 }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "100%", maxWidth: 440, background: "#16142c", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 16, padding: "2rem", zIndex: 10001, display: "flex", flexDirection: "column", gap: "1.25rem",
          }}>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>Replace all files?</h3>
              <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginTop: "0.6rem", lineHeight: 1.5 }}>
                This permanently deletes every current file in <strong>{templateName}</strong> and replaces
                them with <code style={{ background: "rgba(239,68,68,0.1)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>{pendingReplaceFile.name}</code>.
                Any domain already linked to this site stays linked — it'll just serve the new content. This cannot be undone.
              </p>
            </div>
            {replaceError && <p style={{ fontSize: "0.8rem", color: "#f87171", margin: 0 }}>⚠️ {replaceError}</p>}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setPendingReplaceFile(null)}
                disabled={replacing}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 600, background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(240,242,255,0.7)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReplace()}
                disabled={replacing}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 700, background: "linear-gradient(135deg, #ef4444, #b91c1c)", color: "#fff", border: "none", cursor: replacing ? "default" : "pointer", opacity: replacing ? 0.6 : 1 }}
              >
                {replacing ? "Replacing…" : "Replace"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
