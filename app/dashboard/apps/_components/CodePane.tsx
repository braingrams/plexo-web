"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Editor, { useMonaco, type Monaco, type OnMount } from "@monaco-editor/react";
import { ChevronDown, ChevronRight, FilePlus, FileText, Folder, FolderOpen, PanelLeft, Pencil, Save, Search, Trash2, X } from "lucide-react";
import { appsApi, ApiError, type FileEntry } from "./api";
import { C, Button, Notice, Empty, inputStyle } from "./ui";
import { ensureMonaco, languageFor } from "./monaco";
import { useMonacoTheme } from "../../_components/EditorTheme";


// Code Mode: hand-editing the app's working copy. Saving goes straight to the files API and
// never spends AI credits; the parent rebuilds the preview via onSaved.

type MonacoEditor = Parameters<OnMount>[0];

type Tab = {
  path: string;
  kind: "loading" | "text" | "binary" | "error";
  /** Content last known to be on the server. */
  saved: string;
  value: string;
  contentType: string;
  base64?: string;
  loadError?: string;
  saving: boolean;
  saveError?: string;
  savedAt?: number;
  /** The file disappeared from the working copy while this tab had unsaved edits. */
  removed?: boolean;
};

type TreeNode = { name: string; path: string; folder: boolean; children: TreeNode[]; file?: FileEntry };

type Dialog = { kind: "new"; value: string; error?: string; busy?: boolean } | { kind: "rename"; from: string; value: string; error?: string; busy?: boolean } | { kind: "delete"; path: string; error?: string; busy?: boolean };

const AUTOSAVE_MS = 1500;
const NARROW_PX = 560;

const isDirty = (t: Tab) => t.kind === "text" && t.value !== t.saved;
const modelUri = (path: string) => `file:///${path}`;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.hint ? `${err.message} ${err.hint}` : err.message;
  return fallback;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePath(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/{2,}/g, "/");
}

function validatePath(path: string): string | null {
  if (!path) return "Enter a file path, like src/components/Header.tsx.";
  if (path.endsWith("/")) return "That looks like a folder — add a file name at the end.";
  if (path.split("/").some((part) => part === ".." || part === ".")) return "Paths can't contain “.” or “..” segments.";
  return null;
}

let tsConfigured = false;
function configureTypeScript(monaco: Monaco): void {
  if (tsConfigured) return;
  tsConfigured = true;
  const ts = monaco.typescript;
  const compilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    isolatedModules: true,
    baseUrl: ".",
    paths: { "@/*": ["src/*"] },
  };
  // The server build type-checks for real; in the editor, missing node_modules typings would
  // only produce noise.
  const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(compilerOptions);
    defaults.setDiagnosticsOptions(diagnostics);
    defaults.setEagerModelSync(true);
  }
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", folder: true, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const leaf = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.folder === !leaf);
      if (!child) {
        child = { name: part, path, folder: !leaf, children: [], file: leaf ? file : undefined };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export function CodePane(props: { appId: string; openRequest?: { path: string; line?: number; nonce: number } | null; refreshKey?: number; onSaved?: () => void; previewUpdating?: boolean }) {
  const monacoTheme = useMonacoTheme();
  const { appId, openRequest, refreshKey, onSaved } = props;
  ensureMonaco();
  const monaco = useMonaco();

  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["src"]));
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [editor, setEditor] = useState<MonacoEditor | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<Tab[]>([]);
  const activeRef = useRef<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inFlight = useRef(new Set<string>());
  const saveAgain = useRef(new Set<string>());
  const loadSeq = useRef(new Map<string, number>());
  const listSeq = useRef(0);
  const ownedModels = useRef(new Set<string>());
  const pendingReveal = useRef<{ path: string; line: number } | null>(null);
  const onSavedRef = useRef(onSaved);
  const appIdRef = useRef(appId);
  useEffect(() => {
    onSavedRef.current = onSaved;
    appIdRef.current = appId;
  });

  // Tabs live in a ref as well so async save/load callbacks always see the latest edits.
  const updateTabs = useCallback((fn: (tabs: Tab[]) => Tab[]) => {
    tabsRef.current = fn(tabsRef.current);
    setTabs(tabsRef.current);
  }, []);
  const patchTab = useCallback((path: string, patch: Partial<Tab>) => updateTabs((ts) => ts.map((t) => (t.path === path ? { ...t, ...patch } : t))), [updateTabs]);
  const selectTab = useCallback((path: string | null) => {
    activeRef.current = path;
    setActive(path);
  }, []);

  const loadFiles = useCallback(async () => {
    const seq = ++listSeq.current;
    try {
      const res = await appsApi.files(appId);
      if (seq !== listSeq.current) return null;
      setFiles(res.files);
      setListError(null);
      return res.files;
    } catch (err) {
      if (seq !== listSeq.current) return null;
      setListError(errorText(err, "We couldn't load your app's files. Check your connection and try again."));
      return null;
    }
  }, [appId]);

  const loadTabs = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      const seqs = new Map(paths.map((p) => {
        const seq = (loadSeq.current.get(p) ?? 0) + 1;
        loadSeq.current.set(p, seq);
        return [p, seq] as const;
      }));
      const fresh = (p: string) => loadSeq.current.get(p) === seqs.get(p);
      try {
        const res = await appsApi.readFiles(appId, paths);
        const byPath = new Map(res.files.map((f) => [f.path, f]));
        updateTabs((ts) =>
          ts.flatMap((t): Tab[] => {
            if (!seqs.has(t.path) || !fresh(t.path)) return [t];
            // Never clobber edits the user made while the read was in flight.
            if (isDirty(t) || t.saving) return [t];
            const f = byPath.get(t.path);
            if (!f) {
              if (t.kind === "loading") return [{ ...t, kind: "error", loadError: "This file no longer exists." }];
              return [];
            }
            if (typeof f.content === "string") return [{ ...t, kind: "text", saved: f.content, value: f.content, contentType: f.contentType, base64: undefined, loadError: undefined, removed: false }];
            return [{ ...t, kind: "binary", contentType: f.contentType, base64: f.base64, loadError: undefined }];
          }),
        );
        if (activeRef.current && !tabsRef.current.some((t) => t.path === activeRef.current)) selectTab(tabsRef.current.at(-1)?.path ?? null);
      } catch (err) {
        const message = errorText(err, "We couldn't open this file. Check your connection and try again.");
        updateTabs((ts) => ts.map((t) => (seqs.has(t.path) && fresh(t.path) && t.kind === "loading" ? { ...t, kind: "error", loadError: message } : t)));
      }
    },
    [appId, updateTabs, selectTab],
  );

  const savePaths = useCallback(
    async (paths: string[]) => {
      const ready: string[] = [];
      for (const p of paths) {
        const t = tabsRef.current.find((x) => x.path === p);
        if (!t || !isDirty(t)) continue;
        if (inFlight.current.has(p)) saveAgain.current.add(p);
        else ready.push(p);
      }
      if (!ready.length) return;
      for (const p of ready) {
        clearTimeout(timers.current.get(p));
        timers.current.delete(p);
        inFlight.current.add(p);
      }
      const payload = ready.map((p) => ({ path: p, content: tabsRef.current.find((t) => t.path === p)!.value }));
      updateTabs((ts) => ts.map((t) => (ready.includes(t.path) ? { ...t, saving: true, saveError: undefined } : t)));
      try {
        await appsApi.writeFiles(appId, payload);
        const sent = new Map(payload.map((f) => [f.path, f.content]));
        const now = Date.now();
        updateTabs((ts) => ts.map((t) => (sent.has(t.path) ? { ...t, saved: sent.get(t.path)!, saving: false, savedAt: now, removed: false } : t)));
        setFiles((fs) => {
          if (!fs) return fs;
          const sizes = new Map(payload.map((f) => [f.path, new Blob([f.content]).size]));
          const next = fs.map((f) => (sizes.has(f.path) ? { ...f, size: sizes.get(f.path)! } : f));
          const missing = payload.filter((f) => !fs.some((x) => x.path === f.path));
          return missing.length ? [...next, ...missing.map((f) => ({ path: f.path, size: sizes.get(f.path)!, contentType: "text/plain", sha: "" }))] : next;
        });
        onSavedRef.current?.();
      } catch (err) {
        const message = errorText(err, "Couldn't save — check your connection. Your changes are still here.");
        updateTabs((ts) => ts.map((t) => (ready.includes(t.path) ? { ...t, saving: false, saveError: message } : t)));
      } finally {
        ready.forEach((p) => inFlight.current.delete(p));
        const again = ready.filter((p) => saveAgain.current.delete(p));
        if (again.length) void savePaths(again);
      }
    },
    [appId, updateTabs],
  );

  const saveActive = useCallback(() => {
    if (activeRef.current) void savePaths([activeRef.current]);
  }, [savePaths]);
  const saveActiveRef = useRef(saveActive);
  useEffect(() => {
    saveActiveRef.current = saveActive;
  }, [saveActive]);

  const saveAll = useCallback(() => void savePaths(tabsRef.current.filter(isDirty).map((t) => t.path)), [savePaths]);

  const openFile = useCallback(
    (path: string) => {
      if (!tabsRef.current.some((t) => t.path === path)) {
        updateTabs((ts) => [...ts, { path, kind: "loading", saved: "", value: "", contentType: "", saving: false }]);
        void loadTabs([path]);
      }
      selectTab(path);
      if (narrow) setTreeOpen(false);
      // Reveal the file in the tree.
      const parts = path.split("/");
      if (parts.length > 1) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
          return next.size === prev.size ? prev : next;
        });
      }
    },
    [loadTabs, narrow, selectTab, updateTabs],
  );

  const closeTab = useCallback(
    (path: string) => {
      const t = tabsRef.current.find((x) => x.path === path);
      if (t && isDirty(t) && !window.confirm(`${path} has unsaved changes. Close it without saving?`)) return;
      clearTimeout(timers.current.get(path));
      timers.current.delete(path);
      const idx = tabsRef.current.findIndex((x) => x.path === path);
      updateTabs((ts) => ts.filter((x) => x.path !== path));
      if (activeRef.current === path) {
        const rest = tabsRef.current;
        selectTab(rest[Math.min(idx, rest.length - 1)]?.path ?? null);
      }
    },
    [selectTab, updateTabs],
  );

  const onChange = useCallback(
    (value: string | undefined) => {
      const path = activeRef.current;
      if (!path || value === undefined) return;
      const t = tabsRef.current.find((x) => x.path === path);
      if (!t || t.kind !== "text" || t.value === value) return;
      patchTab(path, { value });
      clearTimeout(timers.current.get(path));
      timers.current.set(path, setTimeout(() => {
        timers.current.delete(path);
        void savePaths([path]);
      }, AUTOSAVE_MS));
    },
    [patchTab, savePaths],
  );

  // Initial load, and re-sync whenever the parent says files may have changed (e.g. an AI turn).
  const firstRefresh = useRef(true);
  useEffect(() => {
    void loadFiles();
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    const clean = tabsRef.current.filter((t) => !isDirty(t) && !t.saving && t.kind !== "loading").map((t) => t.path);
    void loadTabs(clean);
    const dirty = tabsRef.current.filter(isDirty).map((t) => t.path);
    if (dirty.length) {
      void appsApi.files(appId).then(
        (res) => {
          const present = new Set(res.files.map((f) => f.path));
          updateTabs((ts) => ts.map((t) => (dirty.includes(t.path) ? { ...t, removed: !present.has(t.path) } : t)));
        },
        () => undefined,
      );
    }
  }, [appId, refreshKey, loadFiles, loadTabs, updateTabs]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.line) pendingReveal.current = { path: openRequest.path, line: openRequest.line };
    openFile(openRequest.path);
    // Only the nonce signals a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  // Keep one Monaco model per open text tab (file:///path) so the TypeScript service can
  // resolve imports between open files; dispose models whose tabs are gone.
  useEffect(() => {
    if (!monaco) return;
    configureTypeScript(monaco);
    const wanted = new Set<string>();
    for (const t of tabs) {
      if (t.kind !== "text") continue;
      const uri = monaco.Uri.parse(modelUri(t.path));
      const key = uri.toString();
      wanted.add(key);
      const model = monaco.editor.getModel(uri);
      if (!model) {
        monaco.editor.createModel(t.value, languageFor(t.path), uri);
        ownedModels.current.add(key);
      } else {
        ownedModels.current.add(key);
        if (model.getValue() !== t.value) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: t.value }], () => null);
      }
    }
    for (const key of [...ownedModels.current]) {
      if (wanted.has(key)) continue;
      const model = monaco.editor.getModel(monaco.Uri.parse(key));
      if (model && editor?.getModel() === model) continue;
      model?.dispose();
      ownedModels.current.delete(key);
    }
  }, [monaco, tabs, editor, active]);

  useEffect(() => {
    const models = ownedModels.current;
    const timerMap = timers.current;
    return () => {
      // Flush pending edits rather than dropping them when the pane unmounts.
      const dirty = tabsRef.current.filter((t) => isDirty(t) && !inFlight.current.has(t.path));
      if (dirty.length) void appsApi.writeFiles(appIdRef.current, dirty.map((t) => ({ path: t.path, content: t.value }))).then(() => onSavedRef.current?.(), () => undefined);
      timerMap.forEach((t) => clearTimeout(t));
      const m = (window as unknown as { monaco?: Monaco }).monaco;
      models.forEach((key) => m?.editor.getModel(m.Uri.parse(key))?.dispose());
      models.clear();
    };
  }, []);

  const anyDirty = tabs.some(isDirty);
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeTab = tabs.find((t) => t.path === active) ?? null;

  // Jump to a line (build errors, Select & Edit) once the file's model is in the editor.
  useEffect(() => {
    const req = pendingReveal.current;
    if (!req || !editor || !monaco || activeTab?.path !== req.path || activeTab.kind !== "text") return;
    const model = editor.getModel();
    if (!model || model.uri.toString() !== monaco.Uri.parse(modelUri(req.path)).toString()) return;
    pendingReveal.current = null;
    const line = Math.max(1, Math.min(req.line, model.getLineCount()));
    editor.revealLineInCenter(line);
    editor.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
    editor.focus();
  });

  const handleMount: OnMount = (ed, m) => {
    configureTypeScript(m);
    ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveActiveRef.current());
    setEditor(ed);
  };

  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActive();
    }
  };

  // ---- file actions -------------------------------------------------------------------

  const submitDialog = async (e: FormEvent) => {
    e.preventDefault();
    if (!dialog || dialog.busy) return;
    if (dialog.kind === "delete") {
      setDialog({ ...dialog, busy: true, error: undefined });
      try {
        await appsApi.deleteFiles(appId, [dialog.path]);
        clearTimeout(timers.current.get(dialog.path));
        timers.current.delete(dialog.path);
        const idx = tabsRef.current.findIndex((t) => t.path === dialog.path);
        updateTabs((ts) => ts.filter((t) => t.path !== dialog.path));
        if (activeRef.current === dialog.path) selectTab(tabsRef.current[Math.min(idx, tabsRef.current.length - 1)]?.path ?? null);
        setFiles((fs) => fs?.filter((f) => f.path !== dialog.path) ?? fs);
        setDialog(null);
        void loadFiles();
        onSavedRef.current?.();
      } catch (err) {
        setDialog({ ...dialog, busy: false, error: errorText(err, "We couldn't delete that file. Try again.") });
      }
      return;
    }
    const path = normalizePath(dialog.value);
    const invalid = validatePath(path) ?? (files?.some((f) => f.path === path) ? "A file with that name already exists." : null);
    if (invalid) {
      setDialog({ ...dialog, error: invalid });
      return;
    }
    setDialog({ ...dialog, busy: true, error: undefined });
    try {
      if (dialog.kind === "new") {
        await appsApi.writeFiles(appId, [{ path, content: "" }]);
        setDialog(null);
        await loadFiles();
        openFile(path);
      } else {
        const from = dialog.from;
        if (path === from) {
          setDialog(null);
          return;
        }
        await appsApi.renameFile(appId, from, path);
        clearTimeout(timers.current.get(from));
        timers.current.delete(from);
        updateTabs((ts) => ts.map((t) => (t.path === from ? { ...t, path } : t)));
        if (activeRef.current === from) selectTab(path);
        setDialog(null);
        await loadFiles();
        // Carry any unsaved edits over to the new path.
        const t = tabsRef.current.find((x) => x.path === path);
        if (t && isDirty(t)) void savePaths([path]);
      }
      onSavedRef.current?.();
    } catch (err) {
      setDialog({ ...dialog, busy: false, error: errorText(err, "That didn't work. Check the path and try again.") });
    }
  };

  // ---- tree -----------------------------------------------------------------------------

  const query = filter.trim().toLowerCase();
  const tree = useMemo(() => buildTree((files ?? []).filter((f) => !query || f.path.toLowerCase().includes(query))), [files, query]);

  const toggleFolder = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const pad = 8 + depth * 12;
      if (node.folder) {
        const open = !!query || expanded.has(node.path);
        return (
          <li key={`d:${node.path}`} role="treeitem" aria-expanded={open} aria-selected={false}>
            <button type="button" className="plx-tree-row" onClick={() => toggleFolder(node.path)} style={{ ...rowStyle, paddingLeft: pad }} aria-label={`${open ? "Collapse" : "Expand"} folder ${node.path}`}>
              {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
              {open ? <FolderOpen size={13} color={C.brand} aria-hidden /> : <Folder size={13} color={C.brand} aria-hidden />}
              <span style={nameStyle}>{node.name}</span>
            </button>
            {open && (
              <ul role="group" style={listReset}>
                {renderNodes(node.children, depth + 1)}
              </ul>
            )}
          </li>
        );
      }
      const isActive = node.path === active;
      const tab = tabs.find((t) => t.path === node.path);
      return (
        <li key={`f:${node.path}`} role="treeitem" aria-selected={isActive} className="plx-tree-item" style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => openFile(node.path)}
            title={node.path}
            aria-label={`Open ${node.path}`}
            style={{ ...rowStyle, paddingLeft: pad + 17, background: isActive ? "color-mix(in srgb, var(--brand) 16%, transparent)" : "transparent", color: isActive ? C.text : "var(--ed-t-800)", paddingRight: 56 }}
          >
            <FileText size={13} color={C.faint} aria-hidden />
            <span style={nameStyle}>{node.name}</span>
            {tab && isDirty(tab) && <span aria-label="unsaved" style={dotStyle} />}
            <span className="plx-size" style={{ marginLeft: "auto", fontSize: "0.66rem", color: C.faint, flexShrink: 0 }}>
              {node.file ? formatSize(node.file.size) : ""}
            </span>
          </button>
          <span className="plx-row-actions" style={{ position: "absolute", right: 4, top: 2, display: "flex", gap: 2 }}>
            <button type="button" style={iconBtn} aria-label={`Rename ${node.path}`} title="Rename or move" onClick={() => setDialog({ kind: "rename", from: node.path, value: node.path })}>
              <Pencil size={12} aria-hidden />
            </button>
            <button type="button" style={iconBtn} aria-label={`Delete ${node.path}`} title="Delete" onClick={() => setDialog({ kind: "delete", path: node.path })}>
              <Trash2 size={12} aria-hidden />
            </button>
          </span>
        </li>
      );
    });

  const showTree = !narrow || treeOpen;
  const dirtyCount = tabs.filter(isDirty).length;
  const anySaving = tabs.some((t) => t.saving);

  let status: { text: string; tone: string } | null = null;
  if (activeTab?.kind === "text") {
    if (activeTab.saving) status = { text: "Saving…", tone: C.muted };
    else if (activeTab.saveError) status = { text: "Not saved", tone: C.danger };
    else if (isDirty(activeTab)) status = { text: "Unsaved changes", tone: C.warning };
    else if (activeTab.savedAt) status = props.previewUpdating ? { text: "Saved · updating preview…", tone: C.muted } : { text: "Saved", tone: C.success };
  }

  return (
    <div ref={rootRef} onKeyDown={onRootKeyDown} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.text, minHeight: 0, position: "relative" }}>
      <style>{`
        .plx-tree-item .plx-row-actions { opacity: 0; transition: opacity 0.12s; }
        .plx-tree-item:hover .plx-row-actions, .plx-tree-item:focus-within .plx-row-actions { opacity: 1; }
        .plx-tree-item:hover .plx-size, .plx-tree-item:focus-within .plx-size { visibility: hidden; }
        .plx-tree-row:hover, .plx-tree-item > button:hover { background: var(--ed-w-040) !important; }
        .plx-code-pane button:focus-visible { outline: 2px solid ${C.brand}; outline-offset: -2px; }
      `}</style>

      <div className="plx-code-pane" style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.45rem 0.6rem", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {narrow && (
          <Button size="sm" variant="ghost" aria-label={treeOpen ? "Hide files" : "Show files"} aria-expanded={treeOpen} onClick={() => setTreeOpen((v) => !v)}>
            <PanelLeft size={14} aria-hidden /> Files
          </Button>
        )}

        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {status && (
            <span role="status" aria-live="polite" style={{ fontSize: "0.72rem", color: status.tone }}>
              {status.text}
            </span>
          )}
          <Button size="sm" variant={dirtyCount ? "primary" : "secondary"} disabled={!dirtyCount || anySaving} onClick={saveAll} aria-label="Save all changed files">
            <Save size={13} aria-hidden /> Save all{dirtyCount ? ` (${dirtyCount})` : ""}
          </Button>
        </span>
      </div>

      <div className="plx-code-pane" style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {showTree && (
          <aside
            aria-label="Files"
            style={{
              width: 240,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              borderRight: `1px solid ${C.border}`,
              background: narrow ? C.panelSolid : C.bg,
              minHeight: 0,
              ...(narrow ? { position: "absolute", inset: "0 auto 0 0", zIndex: 5, boxShadow: "8px 0 24px rgba(0,0,0,0.4)" } : {}),
            }}
          >
            <div style={{ padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ position: "relative" }}>
                <Search size={13} color={C.faint} aria-hidden style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Find a file…"
                  aria-label="Filter files by path"
                  style={{ ...inputStyle, padding: "0.38rem 0.5rem 0.38rem 1.7rem", fontSize: "0.75rem" }}
                />
              </div>
              <Button size="sm" onClick={() => setDialog({ kind: "new", value: active?.includes("/") ? `${active.slice(0, active.lastIndexOf("/") + 1)}` : "src/" })} aria-label="Create a new file" style={{ justifyContent: "center" }}>
                <FilePlus size={13} aria-hidden /> New file
              </Button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "0.3rem 0" }}>
              {listError ? (
                <div style={{ padding: "0.5rem" }}>
                  <Notice tone="danger">{listError}</Notice>
                  <Button size="sm" style={{ marginTop: "0.5rem" }} onClick={() => void loadFiles()}>
                    Try again
                  </Button>
                </div>
              ) : files === null ? (
                <p style={{ padding: "0.6rem 0.8rem", margin: 0, fontSize: "0.75rem", color: C.muted }}>Loading files…</p>
              ) : files.length === 0 ? (
                <Empty title="No files yet">Create a file, or ask SOL to build something.</Empty>
              ) : tree.length === 0 ? (
                <p style={{ padding: "0.6rem 0.8rem", margin: 0, fontSize: "0.75rem", color: C.muted }}>No files match “{filter.trim()}”.</p>
              ) : (
                <ul role="tree" aria-label="App files" style={listReset}>
                  {renderNodes(tree, 0)}
                </ul>
              )}
            </div>
            <p style={{ margin: 0, padding: "0.6rem 0.8rem", borderTop: `1px solid ${C.border}`, fontSize: "0.72rem", color: C.muted, lineHeight: 1.5 }}>Edits here don&rsquo;t use credits.</p>
          </aside>
        )}

        <section aria-label="Editor" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {tabs.length > 0 && (
            <div role="tablist" aria-label="Open files" style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: "var(--ed-w-015)" }}>
              {tabs.map((t) => {
                const selected = t.path === active;
                const dirty = isDirty(t);
                const name = t.path.split("/").pop();
                return (
                  <div key={t.path} style={{ display: "flex", alignItems: "center", borderRight: `1px solid ${C.border}`, background: selected ? C.bg : "transparent", borderBottom: selected ? `2px solid ${C.brand}` : "2px solid transparent", flexShrink: 0 }}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      title={t.path}
                      onClick={() => selectTab(t.path)}
                      onAuxClick={(e) => {
                        if (e.button === 1) closeTab(t.path);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: selected ? C.text : C.muted, fontSize: "0.75rem", padding: "0.45rem 0.25rem 0.45rem 0.7rem", cursor: "pointer", fontFamily: C.mono }}
                    >
                      {name}
                      {t.saveError ? <span aria-label="save failed" style={{ ...dotStyle, background: C.danger }} /> : dirty ? <span aria-label="unsaved changes" style={dotStyle} /> : null}
                    </button>
                    <button type="button" aria-label={`Close ${t.path}`} onClick={() => closeTab(t.path)} style={{ ...iconBtn, marginRight: 4 }}>
                      <X size={12} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab?.saveError && (
            <div style={{ padding: "0.4rem 0.6rem" }}>
              <Notice tone="danger">
                Couldn&apos;t save {activeTab.path}: {activeTab.saveError} Your edits are kept —{" "}
                <button type="button" onClick={saveActive} style={linkBtn}>
                  try again
                </button>
                .
              </Notice>
            </div>
          )}
          {activeTab?.removed && isDirty(activeTab) && (
            <div style={{ padding: "0.4rem 0.6rem" }}>
              <Notice tone="warning">This file was removed (maybe by SOL). Saving will put it back with your edits.</Notice>
            </div>
          )}
          {notice && (
            <div style={{ padding: "0.4rem 0.6rem" }}>
              <Notice tone="warning">
                {notice}{" "}
                <button type="button" onClick={() => setNotice(null)} style={linkBtn}>
                  Dismiss
                </button>
              </Notice>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {!activeTab ? (
              <Empty title={files?.length ? "Pick a file to edit" : "Nothing open"}>
                Choose a file on the left. Changes save automatically and the preview rebuilds — no credits used.
                {narrow && !treeOpen && (
                  <div style={{ marginTop: "0.8rem" }}>
                    <Button size="sm" onClick={() => setTreeOpen(true)} aria-label="Show files">
                      <PanelLeft size={13} aria-hidden /> Show files
                    </Button>
                  </div>
                )}
              </Empty>
            ) : activeTab.kind === "loading" ? (
              <p style={{ padding: "1rem", margin: 0, fontSize: "0.78rem", color: C.muted }}>Opening {activeTab.path}…</p>
            ) : activeTab.kind === "error" ? (
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-start" }}>
                <Notice tone="danger">{activeTab.loadError ?? "We couldn't open this file."}</Notice>
                <Button
                  size="sm"
                  onClick={() => {
                    patchTab(activeTab.path, { kind: "loading", loadError: undefined });
                    void loadTabs([activeTab.path]);
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : activeTab.kind === "binary" ? (
              <BinaryPreview tab={activeTab} />
            ) : (
              <Editor
                height="100%"
                theme={monacoTheme}
                path={modelUri(activeTab.path)}
                language={languageFor(activeTab.path)}
                value={activeTab.value}
                onChange={onChange}
                beforeMount={configureTypeScript}
                onMount={handleMount}
                keepCurrentModel
                loading={<p style={{ padding: "1rem", margin: 0, fontSize: "0.78rem", color: C.muted }}>Loading editor…</p>}
                options={{
                  fontSize: 13,
                  fontFamily: C.mono,
                  minimap: { enabled: !narrow },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: narrow ? "on" : "off",
                  fixedOverflowWidgets: true,
                  padding: { top: 8 },
                }}
              />
            )}
          </div>
        </section>
      </div>

      {dialog && (
        <div
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !dialog.busy) setDialog(null);
          }}
          style={{ position: "absolute", inset: 0, zIndex: 20, background: "var(--ed-scrim)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12%" }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="plx-code-dialog-title"
            onSubmit={submitDialog}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !dialog.busy) setDialog(null);
            }}
            style={{ width: "min(420px, calc(100% - 32px))", background: C.panelSolid, border: `1px solid ${C.borderStrong}`, borderRadius: 14, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.7rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}
          >
            <h3 id="plx-code-dialog-title" style={{ margin: 0, fontSize: "0.9rem" }}>
              {dialog.kind === "new" ? "New file" : dialog.kind === "rename" ? "Rename or move file" : "Delete file?"}
            </h3>
            {dialog.kind === "delete" ? (
              <p style={{ margin: 0, fontSize: "0.78rem", color: C.muted, lineHeight: 1.5 }}>
                <span style={{ fontFamily: C.mono, color: C.text }}>{dialog.path}</span> will be removed from your app. You can bring it back by restoring an earlier version.
                {tabs.some((t) => t.path === dialog.path && isDirty(t)) && " Its unsaved changes will be lost."}
              </p>
            ) : (
              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.74rem", color: C.muted }}>
                {dialog.kind === "new" ? "File path (folders are created for you)" : "New path"}
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value, error: undefined })}
                  placeholder="src/components/Header.tsx"
                  spellCheck={false}
                  style={{ ...inputStyle, fontFamily: C.mono }}
                  aria-invalid={!!dialog.error}
                />
              </label>
            )}
            {dialog.error && <Notice tone="danger">{dialog.error}</Notice>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
              <Button size="sm" variant="ghost" onClick={() => setDialog(null)} disabled={dialog.busy}>
                Cancel
              </Button>
              <Button size="sm" type="submit" variant={dialog.kind === "delete" ? "danger" : "primary"} disabled={dialog.busy} autoFocus={dialog.kind === "delete"}>
                {dialog.busy ? "Working…" : dialog.kind === "new" ? "Create" : dialog.kind === "rename" ? "Rename" : "Delete"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function BinaryPreview({ tab }: { tab: Tab }) {
  const isImage = tab.contentType.startsWith("image/") && !!tab.base64;
  return (
    <div style={{ height: "100%", overflow: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
      <Empty title="This file can't be edited here">
        {tab.path} isn&apos;t a text file{tab.contentType ? ` (${tab.contentType})` : ""}. Replace it by uploading a new one or asking SOL.
      </Empty>
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:${tab.contentType};base64,${tab.base64}`}
          alt={tab.path}
          style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 8, border: `1px solid ${C.border}`, background: "repeating-conic-gradient(#1a2036 0% 25%, var(--ed-panel) 0% 50%) 50% / 16px 16px" }}
        />
      )}
    </div>
  );
}

const listReset: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  width: "100%",
  border: "none",
  background: "transparent",
  color: "var(--ed-t-800)",
  fontSize: "0.76rem",
  padding: "0.26rem 0.5rem",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: C.mono,
};
const nameStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
const dotStyle: CSSProperties = { width: 7, height: 7, borderRadius: "50%", background: C.warning, flexShrink: 0, display: "inline-block" };
const iconBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, border: "none", borderRadius: 6, background: "transparent", color: C.muted, cursor: "pointer" };
const linkBtn: CSSProperties = { border: "none", background: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" };
