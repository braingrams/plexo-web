"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react";
import Link from "next/link";
import { useEditorBackHref, useEditorV3, useSitesListHref } from "../../_components/EditorTheme";
import { useRouter } from "next/navigation";
import CodeMirror, { EditorView, keymap } from "@uiw/react-codemirror";
import { Prec } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import type { FileEntry } from "@/app/api/v1/templates/[id]/files/route";
import { buildPreviewHtml } from "./preview-utils";
import { injectBaseHref } from "@/lib/wpMigration/injectBaseHref";
import { PagesPanel } from "./PagesPanel";
import { SitePlanNotice } from "../../_components/SitePlanNotice";
import { RawTextContentEditor, type RawTextContentEditorHandle, type RawTextContentSaveStatus } from "./RawTextContentEditor";
import { RawAiEditPanel } from "./RawAiEditPanel";
import { SolIcon } from "../../_components/sol/SolTopUp";
import { EmbedCodeModal } from "./EmbedCodeModal";
import { EditModeSwitch } from "./EditModeSwitch";
import { LivePagePreview } from "./LivePagePreview";
import { DesignCanvas } from "./DesignCanvas";
import { BackToBlocks } from "./ConvertToCode";
import { EditModeHint } from "./EditModeHint";
import { canRedo, canUndo, createHistory, current as historyCurrent, record as recordHistory, redo as redoHistory, undo as undoHistory, type History } from "@/lib/editorModes/history";
import { lintHtml, problemSummary, type CodeProblem } from "@/lib/editorModes/htmlLint";
import { jumpTo, problemMarks, setProblems } from "@/lib/editorModes/codeLint";
import { SHORTCUTS, formatShortcut, looksLikeMac } from "@/lib/editorModes/shortcuts";
import { checkSwitch, needsConfirmation, VIEW_LABELS, type EditorViewName, type SwitchNotice } from "@/lib/editorModes/switchCheck";
import { formatHtml } from "@/lib/editorModes/htmlFormat";
import { plexoCompletions } from "@/lib/editorModes/codeCompletions";

type Props = {
  templateId: string;
  /** The site this page belongs to (its home page id) — Commerce products are per site. */
  siteId?: string;
  templateName: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  subscriptionPlan: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH";
  /** A migrated WordPress page's live URL — its theme/media files load from there (see lib/wpMigration/previewBase.ts). */
  previewBaseHref?: string | null;
  /** Which view to open in (from "Edit the code" / "Edit the words" on the Pages list). */
  initialMode?: EditorViewName;
  /** This page started as blocks and can still go back to them. */
  cameFromBlocks?: boolean;
  /** Site health links: put the cursor on this line in Code view, or open this field ("text-3", "img-0") in Text view. */
  initialLine?: number;
  initialField?: string;
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

function IconUndo({ flip }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: "scaleX(-1)" } : undefined} aria-hidden>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

const historyBtn = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 8,
  background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-800)",
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
});

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

// Matches the app's dark shell (var(--ed-bg) background) instead of oneDark's default panel color,
// so the editor doesn't look like a mismatched widget dropped into the page.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--ed-bg)", height: "100%" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.85rem", padding: "1.25rem 1.25rem 1.25rem 0" },
    ".cm-gutters": { backgroundColor: "var(--ed-bg)", borderRight: "1px solid var(--ed-w-060)", color: "var(--ed-t-250)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--ed-w-040)" },
    ".cm-activeLine": { backgroundColor: "var(--ed-w-030)" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true }
);

export function RawFileEditor({ templateId, siteId, templateName, templateKind, subscriptionPlan, useAi, aiProvider, aiTier, previewBaseHref, initialMode, cameFromBlocks, initialLine, initialField }: Props) {
  const v3 = useEditorV3();
  const exitHref = useEditorBackHref(siteId ?? templateId);
  const sitesHref = useSitesListHref();
  const backHref = v3 ? exitHref : sitesHref;
  const router = useRouter();
  // Text Content is the friendlier, non-technical default for a freshly-opened raw page —
  // Code is a step down into the file tree for people who actually want to touch markup.
  const [activeMode, setActiveMode] = useState<EditorViewName>(initialMode ?? "text");
  // SOL is a helper beside every view (not a view of its own).
  const [solOpen, setSolOpen] = useState(false);
  // Bumped whenever the page changes behind the Text view's back (SOL applied a change, Code saved), so it reloads.
  const [textKey, setTextKey] = useState(0);
  const [phonePreview, setPhonePreview] = useState(false);
  const [switchAsk, setSwitchAsk] = useState<{ to: EditorViewName; notes: SwitchNotice[] } | null>(null);
  const [siteTokens, setSiteTokens] = useState<Record<string, string> | null>(null);
  // One undo history for the whole page, shared by Design, Code and Text (lib/editorModes/history.ts).
  const historyRef = useRef<History>(createHistory(""));
  const [, setHistoryTick] = useState(0);
  const modeRef = useRef<EditorViewName>(initialMode ?? "text");
  const viewRef = useRef<EditorView | null>(null);
  // On a narrow screen the Code view shows the code or the preview, one at a time.
  const [narrowPane, setNarrowPane] = useState<"code" | "preview">("code");
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  const pendingJumpRef = useRef<number | null>(null);
  pendingJumpRef.current = pendingJump;
  const editsRef = useRef<Record<string, string>>({});
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

  const [embedModalOpen, setEmbedModalOpen] = useState(false);
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
        if (!opts?.silent) {
          setActivePath("index.html");
          historyRef.current = createHistory(initial["index.html"] ?? "");
          setHistoryTick((t) => t + 1);
        }
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
  modeRef.current = activeMode;
  const toolbarSaving = activeMode === "text" ? textContentStatus.saving : saving;
  const toolbarSaveError = activeMode === "text" ? textContentStatus.error : saveError;
  const toolbarSavedFlash = activeMode === "text" ? textContentStatus.savedFlash : savedFlash;
  const toolbarCanSave =
    activeMode === "text"
      ? textContentStatus.dirty && !textContentStatus.saving
      : activeMode === "code"
        ? !!activePath && isDirty(activePath) && !saving
        : isDirty("index.html") && !saving;
  const unsavedHere = activeMode === "text" ? textContentStatus.dirty : anyDirty;

  function handleToolbarSave() {
    if (activeMode === "text") void textContentRef.current?.save();
    else if (activeMode === "code" && activePath) void handleSave(activePath);
    else if (activeMode === "design") void handleSave("index.html");
  }

  editsRef.current = edits;
  // The site's own design tokens (colours, fonts, spacing) for the Code view's suggestions. Optional: defaults apply without them.
  useEffect(() => {
    if (!siteId) return;
    fetch(`/api/v1/sites/${siteId}/brand`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { resolved?: { tokens?: { light?: Record<string, string> } } } | null) => setSiteTokens(b?.resolved?.tokens?.light ?? null))
      .catch(() => undefined);
  }, [siteId]);
  const codeCompletions = useMemo(() => plexoCompletions({ siteTokens, getHtml: () => editsRef.current["index.html"] ?? "" }), [siteTokens]);

  // Plain-language hints for broken code, re-checked shortly after you stop typing (and not at all for a huge page).
  const deferredHtml = useDeferredValue(edits["index.html"] ?? "");
  const problems: CodeProblem[] = useMemo(() => (deferredHtml.length > 600_000 ? [] : lintHtml(deferredHtml)), [deferredHtml]);
  const summary = problemSummary(problems);
  const isMac = typeof navigator !== "undefined" && looksLikeMac(navigator.platform);
  useEffect(() => {
    // The code editor is only there in the Code view; once it is gone its handle is stale.
    if (activeMode !== "code") {
      viewRef.current = null;
      return;
    }
    viewRef.current?.dispatch({ effects: setProblems.of(activePath === "index.html" ? problems : []) });
  }, [problems, activePath, activeMode]);
  // From a Site health link (?mode=code&line=N): put the cursor on that line once the page's code has loaded. Once only.
  const openedLineRef = useRef(false);
  useEffect(() => {
    if (!initialLine || openedLineRef.current || loading || activeMode !== "code") return;
    const source = edits["index.html"];
    if (source === undefined) return;
    openedLineRef.current = true;
    let offset = 0;
    for (let line = 1; line < initialLine; line++) {
      const next = source.indexOf("\n", offset);
      if (next === -1) break;
      offset = next + 1;
    }
    setPendingJump(offset);
  }, [initialLine, loading, activeMode, edits]);
  // "Show this in the code" from the Design view: open Code and put the cursor there.
  useEffect(() => {
    if (pendingJump === null || activeMode !== "code") return;
    const view = viewRef.current;
    if (!view) return;
    jumpTo(view, pendingJump);
    setPendingJump(null);
  }, [pendingJump, activeMode, activePath]);
  const editorKeys = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          { key: "Mod-z", run: () => (stepHistoryRef.current("undo"), true), preventDefault: true },
          { key: "Mod-Shift-z", run: () => (stepHistoryRef.current("redo"), true), preventDefault: true },
          { key: "Mod-y", run: () => (stepHistoryRef.current("redo"), true), preventDefault: true },
          {
            key: "Mod-Shift-f",
            run: (view) => {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatHtml(view.state.doc.toString()) } });
              return true;
            },
            preventDefault: true,
          },
        ]),
      ),
    [],
  );

  /** Saves whatever is unsaved in the current view so the next view starts from the same page. */
  async function saveCurrentView(): Promise<boolean> {
    if (activeMode === "text") {
      if (!textContentStatus.dirty) return true;
      return (await textContentRef.current?.save()) ?? true;
    }
    for (const f of files) {
      if (f.editable && isDirty(f.path) && !(await handleSave(f.path))) return false;
    }
    return true;
  }

  async function goToView(to: EditorViewName) {
    if (unsavedHere && !(await saveCurrentView())) return;
    if (to === "text") setTextKey((k) => k + 1);
    setActiveMode(to);
  }

  /** The one way to change view: say so first if the other view can't change part of the page, otherwise just save and go. */
  function requestView(to: EditorViewName) {
    if (to === activeMode) return;
    const notes = checkSwitch({ html: edits["index.html"] ?? "", from: activeMode, to, unsaved: unsavedHere });
    if (needsConfirmation(notes)) setSwitchAsk({ to, notes });
    else void goToView(to);
  }

  /** Undo / redo for the whole page, whichever view the change was made in. In Design and Text the result is saved straight away. */
  const stepHistoryRef = useRef<(direction: "undo" | "redo") => void>(() => undefined);
  stepHistoryRef.current = stepHistory;
  function stepHistory(direction: "undo" | "redo") {
    const next = direction === "undo" ? undoHistory(historyRef.current) : redoHistory(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    const html = historyCurrent(next);
    editsRef.current = { ...editsRef.current, "index.html": html };
    setEdits((prev) => ({ ...prev, "index.html": html }));
    setHistoryTick((t) => t + 1);
    if (modeRef.current !== "code") void saveIndexNow(html);
  }

  // Every change to the page, from any view, is one more step to undo.
  const indexHtml = edits["index.html"];
  useEffect(() => {
    if (indexHtml === undefined) return;
    const before = historyRef.current;
    historyRef.current = recordHistory(before, indexHtml, { now: Date.now(), join: modeRef.current === "code" });
    if (historyRef.current !== before) setHistoryTick((t) => t + 1);
  }, [indexHtml]);

  // Undo/redo from the keyboard in Design and Text (Code has its own keys, wired to the same history below).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || modeRef.current === "code") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        stepHistory(e.shiftKey ? "redo" : "undo");
      } else if (k === "y") {
        e.preventDefault();
        stepHistory("redo");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Writes the page's code to the site straight away (SOL's "Use and save", undo in Design/Text) and refreshes the Text view. */
  async function saveIndexNow(html: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/files/index.html`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: html }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Save failed.");
      setSavedContent((prev) => ({ ...prev, "index.html": html }));
      setTextKey((k) => k + 1);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      setActiveMode("code");
    } finally {
      setSaving(false);
    }
  }

  /** SOL changed the page. In Code it lands in the editor to review and save; in Design/Text it is saved straight away. */
  async function applySolHtml(html: string) {
    setEdits((prev) => ({ ...prev, "index.html": html }));
    if (activeMode === "code") return;
    editsRef.current = { ...editsRef.current, "index.html": html };
    await saveIndexNow(html);
  }

  async function handleSave(path: string): Promise<boolean> {
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
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      return false;
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
    setPreviewHtml(injectBaseHref(html, previewBaseHref));
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

      if (payload.page?.id) {
        // The file became a real page of the site — open it in its own editor.
        window.location.href = `/dashboard/templates/${payload.page.id}`;
        return;
      }
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
    return <div style={{ padding: "3rem", color: "var(--ed-t-500)" }}>Loading files…</div>;
  }
  if (loadError) {
    return <div style={{ padding: "3rem", color: "var(--ed-danger)" }}>{loadError}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--ed-bg)", color: "var(--ed-text)" }}>
      <PagesPanel
        templateId={templateId}
        subscriptionPlan={subscriptionPlan}
        onNavigate={(pageId) => { if (pageId !== templateId) router.push(`/dashboard/templates/${pageId}`); }}
      />
      <SitePlanNotice templateId={templateId} />
      {/* Toolbar */}
      <div className="raw-editor-toolbar" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--ed-w-080)", flexShrink: 0,
      }}>
        <div className="raw-editor-toolbar-left" style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <Link href={backHref} style={{ color: "var(--ed-t-400)", textDecoration: "none", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.3rem", flexShrink: 0 }}>
            <IconArrowLeft /> {v3 ? "Back to site" : "Templates"}
          </Link>
          <span style={{ fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap" }}>{templateName}</span>
          <span style={{
            fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
            color: "var(--ed-lavender)", background: "color-mix(in srgb, var(--ed-violet) 10%, transparent)", padding: "0.15rem 0.5rem", borderRadius: 5,
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            Your own code
          </span>
          <div className="raw-editor-mode-tabs" style={{ marginLeft: "0.5rem" }}>
            <EditModeSwitch value={activeMode} onChange={requestView} />
          </div>
          {cameFromBlocks && <BackToBlocks templateId={templateId} />}
        </div>
        <div className="raw-editor-toolbar-right" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {toolbarSaveError && <span style={{ color: "var(--ed-danger)", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><IconWarning /> {toolbarSaveError}</span>}
          {toolbarSavedFlash && <span style={{ color: "var(--ed-success)", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><IconCheck /> Saved</span>}
          <input
            ref={replaceInputRef}
            type="file"
            accept=".html,.htm,.zip"
            onChange={handlePickReplaceFile}
            style={{ display: "none" }}
          />
          <div role="group" aria-label="Undo and redo" style={{ display: "inline-flex", gap: 2 }}>
            <button type="button" onClick={() => stepHistory("undo")} disabled={!canUndo(historyRef.current) || (activeMode === "text" && textContentStatus.dirty)} aria-label="Undo" title={activeMode === "text" && textContentStatus.dirty ? "Save your changes first, then you can undo" : `Undo (${formatShortcut("Mod+Z", isMac)}). Works across Design, Code and Text.`} style={historyBtn(!canUndo(historyRef.current) || (activeMode === "text" && textContentStatus.dirty))}>
              <IconUndo />
            </button>
            <button type="button" onClick={() => stepHistory("redo")} disabled={!canRedo(historyRef.current) || (activeMode === "text" && textContentStatus.dirty)} aria-label="Redo" title={`Redo (${formatShortcut("Mod+Shift+Z", isMac)})`} style={historyBtn(!canRedo(historyRef.current) || (activeMode === "text" && textContentStatus.dirty))}>
              <IconUndo flip />
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <button type="button" onClick={() => setShortcutsOpen((o) => !o)} aria-expanded={shortcutsOpen} aria-label="Keyboard shortcuts" title="Keyboard shortcuts" style={{ ...historyBtn(false), fontSize: "0.8rem", fontWeight: 700 }}>
              ?
            </button>
            {shortcutsOpen && (
              <div role="dialog" aria-label="Keyboard shortcuts" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, width: 340, maxWidth: "88vw", background: "var(--ed-panel-2)", border: "1px solid var(--ed-w-120)", borderRadius: 12, padding: "0.8rem 0.9rem", boxShadow: "0 12px 32px rgba(0,0,0,0.35)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong style={{ fontSize: "0.85rem" }}>Keyboard shortcuts</strong>
                  <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--ed-t-600)", cursor: "pointer" }}><IconClose /></button>
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, fontSize: "0.78rem" }}>
                  {SHORTCUTS.map((sc) => (
                    <li key={sc.keys} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <kbd style={{ flexShrink: 0, minWidth: 84, padding: "0.1rem 0.4rem", borderRadius: 5, border: "1px solid var(--ed-w-120)", background: "var(--ed-w-040)", fontFamily: "inherit", fontSize: "0.72rem", textAlign: "center" }}>{formatShortcut(sc.keys, isMac)}</kbd>
                      <span style={{ color: "var(--ed-t-700)", lineHeight: 1.4 }}>{sc.does}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSolOpen((o) => !o)}
            aria-pressed={solOpen}
            title="Ask SOL to change this page for you. You see the result before it is kept. Uses AI credits."
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              padding: "0.45rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
              background: solOpen ? "color-mix(in srgb, var(--brand) 12%, transparent)" : "none",
              border: solOpen ? "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" : "1px solid var(--ed-w-120)",
              color: "var(--ed-t-800)", cursor: "pointer",
            }}
          >
            <SolIcon size={16} /> Ask SOL
          </button>
          <button
            type="button"
            onClick={() => setEmbedModalOpen(true)}
            style={{
              padding: "0.45rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600,
              background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-800)",
              cursor: "pointer",
            }}
            title="Copy a snippet to add a shop grid, cart, checkout, or other commerce widget to your HTML"
          >
            Embed Widget
          </button>
          <button
            type="button"
            onClick={() => replaceInputRef.current?.click()}
            style={{
              padding: "0.45rem 0.9rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 600,
              background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-800)",
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
              background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-800)",
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
              background: "var(--ed-cta)",
              border: "none", color: "var(--ed-on-brand)",
              cursor: !toolbarCanSave ? "default" : "pointer",
              opacity: !toolbarCanSave ? 0.5 : 1,
            }}
          >
            {toolbarSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <EditModeHint pageKey={templateId} />

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {activeMode === "code" && (
      <div className="raw-editor-code-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* File list sidebar */}
        <div className="raw-editor-sidebar" style={{ width: 220, borderRight: "1px solid var(--ed-w-080)", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.9rem 0.4rem" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ed-t-350)" }}>
              Files
            </span>
            <button
              type="button"
              onClick={handleOpenAddFile}
              title="Add a new file (e.g. style.css or script.js) to import from index.html"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                background: "none", border: "1px solid var(--ed-w-120)", borderRadius: 6,
                color: "var(--ed-t-600)", fontSize: "0.7rem", fontWeight: 600,
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
                    color: "var(--ed-t-300)",
                  }}
                >
                  <span style={{
                    display: "inline-flex", flexShrink: 0,
                    transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s",
                  }}>
                    <IconChevronDown />
                  </span>
                  {FILE_GROUP_LABELS[group.key]}
                  <span style={{ fontWeight: 500, color: "var(--ed-t-200)" }}>{group.files.length}</span>
                </button>
                {!isCollapsed && group.files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setActivePath(f.path)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                      padding: "0.6rem 0.9rem", background: f.path === activePath ? "color-mix(in srgb, var(--brand) 10%, transparent)" : "none",
                      border: "none", borderLeft: f.path === activePath ? "2px solid var(--brand)" : "2px solid transparent",
                      color: f.path === activePath ? "var(--ed-text)" : "var(--ed-t-600)",
                      fontSize: "0.8rem", textAlign: "left", cursor: "pointer", fontFamily: "monospace",
                    }}
                    title={`${f.path} — ${formatSize(f.size)}`}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                    {f.editable && isDirty(f.path) && (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ed-amber)", flexShrink: 0, marginLeft: "0.4rem" }} />
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
            <div className="raw-editor-split" data-pane={narrowPane} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div className="raw-editor-narrow-tabs" role="tablist" aria-label="Show the code or the preview" style={{ gap: 2, padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--ed-w-060)", flexShrink: 0 }}>
                {(["code", "preview"] as const).map((pane) => (
                  <button key={pane} type="button" role="tab" aria-selected={narrowPane === pane} onClick={() => setNarrowPane(pane)} style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "none", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", background: narrowPane === pane ? "var(--ed-cta)" : "var(--ed-w-050)", color: narrowPane === pane ? "var(--ed-on-brand)" : "var(--ed-t-700)" }}>
                    {pane === "code" ? "Code" : "Preview"}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <div className="raw-editor-codepane" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--ed-w-080)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--ed-w-060)", flexShrink: 0 }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--ed-t-400)" }}>Type <code>&lt;</code> for ready-made parts, <code>--</code> for your design colours and fonts, or a class name.</span>
                  {/\.html?$/i.test(activeFile.path) && (
                    <button
                      type="button"
                      onClick={() => setEdits((prev) => ({ ...prev, [activeFile.path]: formatHtml(prev[activeFile.path] ?? "") }))}
                      title="Neatly indent the code. Your page looks exactly the same."
                      style={{ padding: "0.25rem 0.65rem", borderRadius: 6, fontSize: "0.72rem", fontWeight: 600, background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-700)", cursor: "pointer", flexShrink: 0 }}
                    >
                      Tidy up
                    </button>
                  )}
                </div>
                {activeFile.path === "index.html" && problems.length > 0 && (
                  <div style={{ borderBottom: "1px solid var(--ed-w-060)", flexShrink: 0, background: "color-mix(in srgb, var(--ed-amber) 8%, transparent)" }}>
                    <button type="button" onClick={() => setProblemsOpen((o) => !o)} aria-expanded={problemsOpen} style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.75rem", background: "none", border: "none", color: "var(--ed-t-800)", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                      <IconWarning /> {summary}
                      <span style={{ marginLeft: "auto", fontWeight: 500, color: "var(--ed-t-500)" }}>{problemsOpen ? "Hide" : "Show"}</span>
                    </button>
                    {problemsOpen && (
                      <ul style={{ listStyle: "none", margin: 0, padding: "0 0.75rem 0.5rem", maxHeight: 170, overflowY: "auto", display: "grid", gap: 4 }}>
                        {problems.map((pr, i) => (
                          <li key={`${pr.from}-${i}`}>
                            <button type="button" onClick={() => viewRef.current && jumpTo(viewRef.current, pr.from)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "0.2rem 0", cursor: "pointer", fontSize: "0.76rem", lineHeight: 1.45, color: pr.severity === "error" ? "var(--ed-t-850)" : "var(--ed-t-600)" }}>
                              <span style={{ fontWeight: 700, color: pr.severity === "error" ? "var(--ed-danger)" : "var(--ed-amber)" }}>Line {pr.line}</span> {pr.message}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <CodeMirror
                  value={edits[activeFile.path] ?? ""}
                  onChange={(value) => setEdits((prev) => ({ ...prev, [activeFile.path]: value }))}
                  onCreateEditor={(view) => {
                    viewRef.current = view;
                    if (activePath === "index.html") view.dispatch({ effects: setProblems.of(problems) });
                    if (pendingJumpRef.current !== null) {
                      jumpTo(view, pendingJumpRef.current);
                      setPendingJump(null);
                    }
                  }}
                  extensions={[languageExtension, editorTheme, EditorView.lineWrapping, codeCompletions, editorKeys, ...problemMarks]}
                  theme={oneDark}
                  // The page has one undo history shared by every view (editorKeys above), not one that is forgotten when you switch.
                  basicSetup={{ tabSize: 2, history: false }}
                  indentWithTab
                  height="100%"
                  style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
                />
              </div>
              <div className="raw-editor-livepane" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--ed-w-060)", fontSize: "0.72rem", color: "var(--ed-t-400)", flexShrink: 0 }}>Live preview. Updates as you type.</div>
                <LivePagePreview files={files} edits={edits} rootPath={/\.html?$/i.test(activeFile.path) ? activeFile.path : "index.html"} baseHref={previewBaseHref} />
              </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", color: "var(--ed-t-500)" }}>
              {activeFile.contentType.startsWith("image/") && activeFile.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeFile.url} alt={activeFile.path} style={{ maxWidth: "60%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--ed-w-100)" }} />
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
          key={textKey}
          ref={textContentRef}
          templateId={templateId}
          initialField={initialField}
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

      {activeMode === "design" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", padding: "0.5rem 1.25rem", borderBottom: "1px solid var(--ed-w-060)", flexShrink: 0 }}>
            <span style={{ fontSize: "0.78rem", color: "var(--ed-t-400)" }}>This is your page as visitors see it. <strong>Click anything</strong> to change it, use <strong>Text</strong> for a list of all the words, <strong>Code</strong> to change the page itself, or ask SOL.</span>
            <button type="button" onClick={() => setPhonePreview((v) => !v)} aria-pressed={phonePreview} style={{ padding: "0.3rem 0.75rem", borderRadius: 7, fontSize: "0.75rem", fontWeight: 600, background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-700)", cursor: "pointer" }}>
              {phonePreview ? "Show full width" : "Show on a phone"}
            </button>
          </div>
          <DesignCanvas
            files={files}
            edits={edits}
            html={edits["index.html"] ?? ""}
            onChangeHtml={(next) => setEdits((prev) => ({ ...prev, "index.html": next }))}
            baseHref={previewBaseHref}
            phone={phonePreview}
            onShowInCode={(offset) => {
              setPendingJump(offset);
              requestView("code");
            }}
          />
        </div>
      )}
        </div>
        {solOpen && (
          <aside className="raw-editor-sol" aria-label="SOL" style={{ width: 400, maxWidth: "100%", flexShrink: 0, borderLeft: "1px solid var(--ed-w-080)", background: "var(--ed-bg)", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.9rem", borderBottom: "1px solid var(--ed-w-060)", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}><SolIcon size={16} /> SOL</span>
              <button type="button" onClick={() => setSolOpen(false)} aria-label="Close SOL" style={{ background: "none", border: "none", color: "var(--ed-t-600)", cursor: "pointer" }}><IconClose /></button>
            </div>
            <RawAiEditPanel
              templateId={templateId}
              templateKind={templateKind}
              currentHtml={edits["index.html"] ?? ""}
              useAi={useAi}
              aiProvider={aiProvider}
              aiTier={aiTier}
              subscriptionPlan={subscriptionPlan}
              docked
              applyLabel={activeMode === "code" ? "Use this change" : "Use and save this change"}
              onApply={(html) => void applySolHtml(html)}
            />
          </aside>
        )}
      </div>

      {switchAsk && (
        <>
          <div onClick={() => setSwitchAsk(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000 }} />
          <div role="dialog" aria-modal="true" aria-label="Before you switch" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "calc(100% - 2rem)", maxWidth: 460, background: "var(--ed-panel-2)", border: "1px solid var(--ed-w-120)", borderRadius: 16, padding: "clamp(1.25rem, 5vw, 1.75rem)", zIndex: 10001, display: "flex", flexDirection: "column", gap: "1rem", maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, margin: 0 }}>Switch to {VIEW_LABELS[switchAsk.to]}?</h3>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem", lineHeight: 1.5, color: "var(--ed-t-700)" }}>
              {switchAsk.notes.map((n, i) => <li key={i}>{n.text}</li>)}
            </ul>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ed-t-500)" }}>Nothing on your page is removed either way.</p>
            <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSwitchAsk(null)} style={{ padding: "0.55rem 1rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 600, background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-700)", cursor: "pointer" }}>Stay in {VIEW_LABELS[activeMode]}</button>
              <button type="button" onClick={() => { const to = switchAsk.to; setSwitchAsk(null); void goToView(to); }} style={{ padding: "0.55rem 1rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 700, background: "var(--ed-cta)", border: "none", color: "var(--ed-on-brand)", cursor: "pointer" }}>Switch to {VIEW_LABELS[switchAsk.to]}</button>
            </div>
          </div>
        </>
      )}

      {/* Preview modal */}
      {previewOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.25rem", background: "var(--ed-panel)", borderBottom: "1px solid var(--ed-w-100)" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--ed-t-700)" }}>
              Previewing <strong style={{ fontFamily: "monospace", color: "var(--ed-text)" }}>{previewRootPath}</strong> — reflects unsaved edits, exactly as it will render once published
            </span>
            <button type="button" onClick={handleClosePreview} style={{ background: "none", border: "none", color: "var(--ed-t-600)", cursor: "pointer" }}>
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
            width: "calc(100% - 2rem)", maxWidth: 440, background: "var(--ed-panel-2)", border: "1px solid color-mix(in srgb, var(--ed-danger) 25%, transparent)",
            borderRadius: 16, padding: "clamp(1.25rem, 5vw, 2rem)", zIndex: 10001, display: "flex", flexDirection: "column", gap: "1.25rem",
            maxHeight: "calc(100vh - 2rem)", overflowY: "auto",
          }}>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>Replace all files?</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--ed-t-600)", marginTop: "0.6rem", lineHeight: 1.5 }}>
                This permanently deletes every current file in <strong>{templateName}</strong> and replaces
                them with <code style={{ background: "color-mix(in srgb, var(--ed-danger) 10%, transparent)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>{pendingReplaceFile.name}</code>.
                Any domain already linked to this site stays linked — it'll just serve the new content. This cannot be undone.
              </p>
            </div>
            {replaceError && <p style={{ fontSize: "0.8rem", color: "var(--ed-danger)", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}><IconWarning /> {replaceError}</p>}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setPendingReplaceFile(null)}
                disabled={replacing}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 600, background: "none", border: "1px solid var(--ed-w-100)", color: "var(--ed-t-700)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReplace()}
                disabled={replacing}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 700, background: "var(--ed-danger-fill)", color: "var(--ed-on-danger)", border: "none", cursor: replacing ? "default" : "pointer", opacity: replacing ? 0.6 : 1 }}
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
            width: "calc(100% - 2rem)", maxWidth: 420, background: "var(--ed-panel-2)", border: "1px solid var(--ed-w-100)",
            borderRadius: 16, padding: "clamp(1.25rem, 5vw, 2rem)", zIndex: 10001, display: "flex", flexDirection: "column", gap: "1.1rem",
            maxHeight: "calc(100vh - 2rem)", overflowY: "auto",
          }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, margin: 0 }}>Add a file</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--ed-t-600)", marginTop: "0.5rem", lineHeight: 1.5 }}>
                Upload an existing <code style={{ background: "var(--ed-w-060)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>.css</code>/<code style={{ background: "var(--ed-w-060)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>.js</code> file,
                or just name a new blank one. Import it from{" "}
                <code style={{ background: "var(--ed-w-060)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>index.html</code> with a{" "}
                <code style={{ background: "var(--ed-w-060)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>&lt;link&gt;</code> or{" "}
                <code style={{ background: "var(--ed-w-060)", padding: "0.1rem 0.3rem", borderRadius: 4 }}>&lt;script&gt;</code> tag.
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
                padding: "0.55rem 0.75rem", borderRadius: 8, background: "var(--ed-w-050)", border: "1px solid var(--ed-w-120)",
              }}>
                <span style={{ fontSize: "0.8rem", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pickedUploadFile.name} — {formatSize(pickedUploadFile.size)}
                </span>
                <button
                  type="button"
                  onClick={() => { setPickedUploadFile(null); setNewFileName(""); }}
                  disabled={addingFile}
                  style={{ background: "none", border: "none", color: "var(--ed-t-500)", cursor: "pointer", flexShrink: 0 }}
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
                  background: "none", border: "1px dashed var(--ed-w-200)", color: "var(--ed-t-700)",
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
                background: "var(--ed-w-050)", border: "1px solid var(--ed-w-120)", color: "var(--ed-text)",
              }}
            />
            {addFileError && <p style={{ fontSize: "0.8rem", color: "var(--ed-danger)", margin: 0, display: "flex", alignItems: "center", gap: "0.35rem" }}><IconWarning /> {addFileError}</p>}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setAddFileOpen(false)}
                disabled={addingFile}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 600, background: "none", border: "1px solid var(--ed-w-100)", color: "var(--ed-t-700)", cursor: "pointer" }}
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
                  background: "var(--ed-cta)", color: "var(--ed-on-brand)", border: "none",
                  cursor: addingFile ? "default" : "pointer", opacity: addingFile ? 0.6 : 1,
                }}
              >
                {addingFile ? "Adding…" : "Add file"}
              </button>
            </div>
          </div>
        </>
      )}

      {embedModalOpen && <EmbedCodeModal onClose={() => setEmbedModalOpen(false)} siteId={siteId} pageId={templateId} canAddForMe={!anyDirty} onAdded={() => void loadFiles({ silent: true })} />}

      <style jsx>{`
        /* Wraps at any width (the app menu takes room too), so nothing overlaps or breaks onto two lines. */
        .raw-editor-toolbar { flex-wrap: wrap; gap: 0.6rem; }
        .raw-editor-toolbar-left { flex-wrap: wrap; gap: 0.5rem; }
        .raw-editor-toolbar-right { flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
        .raw-editor-toolbar-right button, .raw-editor-toolbar-right a { white-space: nowrap; }
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
        .raw-editor-narrow-tabs { display: none; }
        @media (max-width: 1100px) {
          .raw-editor-narrow-tabs { display: flex; }
          .raw-editor-split[data-pane="code"] .raw-editor-livepane { display: none !important; }
          .raw-editor-split[data-pane="preview"] .raw-editor-codepane { display: none !important; }
          .raw-editor-split[data-pane="preview"] .raw-editor-livepane { border-left: none; }
        }
        @media (max-width: 700px) {
          .raw-editor-sol { position: fixed; inset: auto 0 0 0; width: 100% !important; height: 65vh; z-index: 9000; border-left: none !important; border-top: 1px solid var(--ed-w-120); }
          .raw-editor-code-body {
            flex-direction: column;
          }
          .raw-editor-sidebar {
            width: 100% !important;
            max-height: 180px;
            border-right: none !important;
            border-bottom: 1px solid var(--ed-w-080);
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
