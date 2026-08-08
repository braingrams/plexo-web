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
import { RawTextContentEditor, type RawTextContentEditorHandle, type RawTextContentSaveStatus } from "./RawTextContentEditor";
import { RawAiEditPanel } from "./RawAiEditPanel";

type Props = {
  templateId: string;
  templateName: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  subscriptionPlan: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
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

function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
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

type FileGroupKey = "html" | "css" | "js" | "other";

const FILE_GROUP_LABELS: Record<FileGroupKey, string> = {
  html: "Pages",
  css: "Styles",
  js: "Scripts",
  other: "Assets",
};

function categorizeFile(path: string): FileGroupKey {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "js";
  return "other";
}

/** Groups the flat file list by type (a plain alphabetical sort across the whole list
 * interleaves e.g. "contact.html", "css/styles.css", "destinations.html" purely because "c"
 * sorts before "d") — HTML pages first, then styles, then scripts, then everything else,
 * alphabetical within each group; index.html always leads the HTML group regardless of
 * alphabetical order, since it's the site's actual entry point. */
function groupFilesByType(files: FileEntry[]): { key: FileGroupKey; files: FileEntry[] }[] {
  const buckets: Record<FileGroupKey, FileEntry[]> = { html: [], css: [], js: [], other: [] };
  for (const f of files) buckets[categorizeFile(f.path)].push(f);
  buckets.html.sort((a, b) => (a.path === "index.html" ? -1 : b.path === "index.html" ? 1 : a.path.localeCompare(b.path)));
  buckets.css.sort((a, b) => a.path.localeCompare(b.path));
  buckets.js.sort((a, b) => a.path.localeCompare(b.path));
  buckets.other.sort((a, b) => a.path.localeCompare(b.path));
  return (["html", "css", "js", "other"] as const)
    .map((key) => ({ key, files: buckets[key] }))
    .filter((group) => group.files.length > 0);
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

export function RawFileEditor({ templateId, templateName, templateKind, subscriptionPlan, useAi, aiProvider, aiTier }: Props) {
  const router = useRouter();
  const [activeMode, setActiveMode] = useState<"code" | "text" | "ai">("code");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedContent, setSavedContent] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState<string>("index.html");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // The Text Content tab has no Save button of its own — this toolbar's one Save button
  // dispatches to either the code editor's own save (below) or this, depending on
  // activeMode. textContentStatus mirrors that tab's dirty/saving/error/savedFlash state,
  // reported up via RawTextContentEditor's onStatusChange.
  const textContentRef = useRef<RawTextContentEditorHandle>(null);
  const [textContentStatus, setTextContentStatus] = useState<RawTextContentSaveStatus>({
    dirty: false,
    saving: false,
    error: null,
    savedFlash: false,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewRootPath, setPreviewRootPath] = useState("index.html");
  const previewCleanupRef = useRef<(() => void) | null>(null);

  const [pendingReplaceFile, setPendingReplaceFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const [addFileOpen, setAddFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [pickedUploadFile, setPickedUploadFile] = useState<File | null>(null);
  const [addingFile, setAddingFile] = useState(false);
  const [addFileError, setAddFileError] = useState<string | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);

  // `silent` skips the loading/error/activePath side effects — used for a background
  // refresh (see RawTextContentEditor's onSaved below) where toggling `loading` would hit
  // this component's `if (loading) return <div>Loading files…</div>` guard further down and
  // unmount EVERYTHING under it, including the Text Content tab's live-patched preview
  // iframe and all its in-memory state — confirmed as exactly why a Text Content save was
  // making that preview appear to "lose" the edit it had just shown, until a full page
  // reload remounted it fresh. A silent refresh still needs to update `files`/`edits` (the
  // Code tab's own snapshot the toolbar's "Preview" button reads from) without any of that.
  const loadFiles = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setLoadError(null);
    }
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
        if (!opts?.silent) setActivePath("index.html");
      })
      .catch((err) => {
        if (!opts?.silent) setLoadError(err instanceof Error ? err.message : "Failed to load files.");
      })
      .finally(() => {
        if (!opts?.silent) setLoading(false);
      });
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
  const fileGroups = useMemo(() => groupFilesByType(files), [files]);
  // Starts empty (every group expanded) — collapsing is a per-session convenience, not
  // something worth persisting, same as RawTextContentEditor's Images/Colors accordions.
  const [collapsedFileGroups, setCollapsedFileGroups] = useState<Set<FileGroupKey>>(new Set());
  function toggleFileGroup(key: FileGroupKey) {
    setCollapsedFileGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const isDirty = useCallback(
    (path: string) => edits[path] !== undefined && edits[path] !== savedContent[path],
    [edits, savedContent]
  );
  const anyDirty = files.some((f) => f.editable && isDirty(f.path));

  // The one toolbar Save button dispatches by tab: Code saves index.html/whatever file is
  // open, Text Content saves via the ref exposed by RawTextContentEditor, AI has no save of
  // its own (applying switches you to Code, which is saved from there).
  const toolbarSaving = activeMode === "text" ? textContentStatus.saving : saving;
  const toolbarSaveError = activeMode === "text" ? textContentStatus.error : saveError;
  const toolbarSavedFlash = activeMode === "text" ? textContentStatus.savedFlash : savedFlash;
  const toolbarCanSave =
    activeMode === "text"
      ? textContentStatus.dirty && !textContentStatus.saving
      : activeMode === "code"
        ? !!activePath && isDirty(activePath) && !saving
        : false;

  function handleToolbarSave() {
    if (activeMode === "text") void textContentRef.current?.save();
    else if (activeMode === "code" && activePath) void handleSave(activePath);
  }

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

  function handleOpenAddFile() {
    setNewFileName("");
    setPickedUploadFile(null);
    setAddFileError(null);
    setAddFileOpen(true);
    setTimeout(() => newFileInputRef.current?.focus(), 0);
  }

  function handlePickUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // allow picking the same filename again later
    if (!file) return;
    setPickedUploadFile(file);
    setNewFileName(file.name);
    setAddFileError(null);
  }

  async function handleCreateFile() {
    const path = newFileName.trim();
    if (!path) {
      setAddFileError("Enter a file name.");
      return;
    }
    setAddingFile(true);
    setAddFileError(null);
    try {
      let res: Response;
      if (pickedUploadFile) {
        const form = new FormData();
        form.append("file", pickedUploadFile);
        form.append("path", path);
        res = await fetch(`/api/v1/templates/${templateId}/files`, { method: "POST", body: form });
      } else {
        res = await fetch(`/api/v1/templates/${templateId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
      }
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Couldn't create the file.");

      const newFile: FileEntry = payload.file;
      setFiles((prev) => [...prev, newFile].sort((a, b) => (a.path === "index.html" ? -1 : b.path === "index.html" ? 1 : a.path.localeCompare(b.path))));
      if (newFile.editable) {
        setEdits((prev) => ({ ...prev, [newFile.path]: newFile.content ?? "" }));
        setSavedContent((prev) => ({ ...prev, [newFile.path]: newFile.content ?? "" }));
      }
      setActivePath(newFile.path);
      setAddFileOpen(false);
      setPickedUploadFile(null);
    } catch (err) {
      setAddFileError(err instanceof Error ? err.message : "Couldn't create the file.");
    } finally {
      setAddingFile(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (toolbarCanSave) handleToolbarSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toolbarCanSave, handleToolbarSave]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="raw-editor-toolbar" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.85rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <div className="raw-editor-toolbar-left" style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <Link href="/dashboard/templates" style={{ color: "rgba(240,242,255,0.4)", textDecoration: "none", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.3rem", flexShrink: 0 }}>
            <IconArrowLeft /> Templates
          </Link>
          <span style={{ fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap" }}>{templateName}</span>
          <span style={{
            fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
            color: "#818cf8", background: "rgba(99,102,241,0.1)", padding: "0.15rem 0.5rem", borderRadius: 5,
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            Raw Upload
          </span>
          <div className="raw-editor-mode-tabs" style={{ display: "flex", gap: "0.3rem", marginLeft: "0.5rem" }}>
            {([
              { key: "code", label: "Code" },
              { key: "text", label: "Text Content" },
              { key: "ai", label: "AI Edit" },
            ] as const).map((tab) => {
              const disabled = tab.key !== "code" && isDirty("index.html");
              return (
                <button
                  key={tab.key}
                  type="button"
                  disabled={disabled}
                  title={disabled ? "Save your code changes to index.html first" : undefined}
                  onClick={() => setActiveMode(tab.key)}
                  style={{
                    padding: "0.35rem 0.75rem", borderRadius: 7, fontSize: "0.78rem", fontWeight: 600,
                    background: activeMode === tab.key ? "rgba(139,92,246,0.1)" : "none",
                    border: activeMode === tab.key ? "1px solid rgba(139,92,246,0.3)" : "1px solid rgba(255,255,255,0.1)",
                    color: disabled ? "rgba(240,242,255,0.25)" : activeMode === tab.key ? "#c4b5fd" : "rgba(240,242,255,0.6)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="raw-editor-toolbar-right" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {toolbarSaveError && <span style={{ color: "#f87171", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><IconWarning /> {toolbarSaveError}</span>}
          {toolbarSavedFlash && <span style={{ color: "#34d399", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><IconCheck /> Saved</span>}
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
            disabled={!toolbarCanSave}
            onClick={handleToolbarSave}
            className="btn-primary"
            style={{
              padding: "0.45rem 1.1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              border: "none", color: "#fff",
              cursor: !toolbarCanSave ? "default" : "pointer",
              opacity: !toolbarCanSave ? 0.5 : 1,
            }}
          >
            {toolbarSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Body */}
      {activeMode === "code" && (
      <div className="raw-editor-code-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* File list sidebar */}
        <div className="raw-editor-sidebar" style={{ width: 220, borderRight: "1px solid rgba(255,255,255,0.08)", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.9rem 0.4rem" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(240,242,255,0.35)" }}>
              Files
            </span>
            <button
              type="button"
              onClick={handleOpenAddFile}
              title="Add a new file (e.g. style.css or script.js) to import from index.html"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
                color: "rgba(240,242,255,0.6)", fontSize: "0.7rem", fontWeight: 600,
                padding: "0.15rem 0.45rem", cursor: "pointer",
              }}
            >
              <IconPlus /> Add
            </button>
          </div>
          {fileGroups.map((group) => {
            const isCollapsed = collapsedFileGroups.has(group.key);
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggleFileGroup(group.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.3rem", width: "100%",
                    padding: "0.55rem 0.9rem 0.25rem",
                    background: "none", border: "none", cursor: "pointer", textAlign: "left",
                    fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                    color: "rgba(240,242,255,0.3)",
                  }}
                >
                  <span style={{
                    display: "inline-flex", flexShrink: 0,
                    transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s",
                  }}>
                    <IconChevronDown />
                  </span>
                  {FILE_GROUP_LABELS[group.key]}
                  <span style={{ fontWeight: 500, color: "rgba(240,242,255,0.2)" }}>{group.files.length}</span>
                </button>
                {!isCollapsed && group.files.map((f) => (
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
            );
          })}
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
      )}

      {activeMode === "text" && (
        <RawTextContentEditor
          ref={textContentRef}
          templateId={templateId}
          onStatusChange={setTextContentStatus}
          onSaved={() => {
            // Refetch so the toolbar's "Preview" button (built from this Code tab's own
            // files/edits snapshot) picks up what was just saved instead of showing stale
            // pre-edit content — but only when there's nothing unsaved here to lose:
            // loadFiles() replaces `edits` wholesale, which would silently discard an
            // in-progress Code tab edit to some OTHER file (only index.html's dirtiness
            // blocks switching to this tab, so e.g. a dirty css/styles.css could coexist).
            if (!anyDirty) void loadFiles({ silent: true });
          }}
        />
      )}

      {activeMode === "ai" && (
        <RawAiEditPanel
          templateId={templateId}
          templateKind={templateKind}
          currentHtml={edits["index.html"] ?? ""}
          useAi={useAi}
          aiProvider={aiProvider}
          aiTier={aiTier}
          subscriptionPlan={subscriptionPlan}
          onApply={(html) => {
            setEdits((prev) => ({ ...prev, "index.html": html }));
            setActiveMode("code");
            setActivePath("index.html");
          }}
        />
      )}

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
            width: "calc(100% - 2rem)", maxWidth: 440, background: "#16142c", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 16, padding: "clamp(1.25rem, 5vw, 2rem)", zIndex: 10001, display: "flex", flexDirection: "column", gap: "1.25rem",
            maxHeight: "calc(100vh - 2rem)", overflowY: "auto",
          }}>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>Replace all files?</h3>
              <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginTop: "0.6rem", lineHeight: 1.5 }}>
                This permanently deletes every current file in <strong>{templateName}</strong> and replaces
                them with <code style={{ background: "rgba(239,68,68,0.1)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>{pendingReplaceFile.name}</code>.
                Any domain already linked to this site stays linked — it'll just serve the new content. This cannot be undone.
              </p>
            </div>
            {replaceError && <p style={{ fontSize: "0.8rem", color: "#f87171", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}><IconWarning /> {replaceError}</p>}
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

      {/* Add-file dialog */}
      {addFileOpen && (
        <>
          <div
            onClick={() => !addingFile && setAddFileOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000 }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "calc(100% - 2rem)", maxWidth: 420, background: "#16142c", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 16, padding: "clamp(1.25rem, 5vw, 2rem)", zIndex: 10001, display: "flex", flexDirection: "column", gap: "1.1rem",
            maxHeight: "calc(100vh - 2rem)", overflowY: "auto",
          }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, margin: 0 }}>Add a file</h3>
              <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", marginTop: "0.5rem", lineHeight: 1.5 }}>
                Upload an existing <code style={{ background: "rgba(255,255,255,0.06)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>.css</code>/<code style={{ background: "rgba(255,255,255,0.06)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>.js</code> file,
                or just name a new blank one. Import it from{" "}
                <code style={{ background: "rgba(255,255,255,0.06)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>index.html</code> with a{" "}
                <code style={{ background: "rgba(255,255,255,0.06)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>&lt;link&gt;</code> or{" "}
                <code style={{ background: "rgba(255,255,255,0.06)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>&lt;script&gt;</code> tag.
              </p>
            </div>

            <input
              ref={uploadFileInputRef}
              type="file"
              accept=".html,.htm,.css,.js,.mjs,.json,.txt,.xml,.map,.webmanifest,.png,.jpg,.jpeg,.gif,.svg,.webp,.avif,.ico,.woff,.woff2,.ttf,.otf,.eot"
              onChange={handlePickUploadFile}
              style={{ display: "none" }}
            />
            {pickedUploadFile ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
                padding: "0.55rem 0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
              }}>
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pickedUploadFile.name} — {formatSize(pickedUploadFile.size)}
                </span>
                <button
                  type="button"
                  onClick={() => { setPickedUploadFile(null); setNewFileName(""); }}
                  disabled={addingFile}
                  style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", cursor: "pointer", flexShrink: 0 }}
                  title="Remove picked file"
                >
                  <IconClose />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => uploadFileInputRef.current?.click()}
                disabled={addingFile}
                style={{
                  padding: "0.55rem 0.75rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600,
                  background: "none", border: "1px dashed rgba(255,255,255,0.2)", color: "rgba(240,242,255,0.7)",
                  cursor: "pointer", textAlign: "left",
                }}
              >
                Choose a file to upload…
              </button>
            )}

            <input
              ref={newFileInputRef}
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateFile();
                if (e.key === "Escape") setAddFileOpen(false);
              }}
              placeholder="style.css"
              disabled={addingFile}
              style={{
                width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, fontSize: "0.85rem", fontFamily: "monospace",
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0f2ff",
              }}
            />
            {addFileError && <p style={{ fontSize: "0.8rem", color: "#f87171", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}><IconWarning /> {addFileError}</p>}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setAddFileOpen(false)}
                disabled={addingFile}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 600, background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(240,242,255,0.7)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateFile()}
                disabled={addingFile}
                className="btn-primary"
                style={{
                  flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 700,
                  background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", border: "none",
                  cursor: addingFile ? "default" : "pointer", opacity: addingFile ? 0.6 : 1,
                }}
              >
                {addingFile ? "Adding…" : "Add file"}
              </button>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        @media (max-width: 900px) {
          .raw-editor-toolbar {
            flex-wrap: wrap;
            gap: 0.6rem;
          }
          .raw-editor-toolbar-left {
            flex-wrap: wrap;
            gap: 0.5rem;
          }
          .raw-editor-toolbar-right {
            flex-wrap: wrap;
            width: 100%;
            justify-content: flex-start;
          }
          .raw-editor-mode-tabs {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
        }
        @media (max-width: 700px) {
          .raw-editor-code-body {
            flex-direction: column;
          }
          .raw-editor-sidebar {
            width: 100% !important;
            max-height: 180px;
            border-right: none !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          }
        }
        @media (max-width: 480px) {
          .raw-editor-toolbar {
            padding: 0.65rem 0.85rem !important;
          }
        }
      `}</style>
    </div>
  );
}
