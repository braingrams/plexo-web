"use client";

import "@charisol/plexo-sdk/dist/plexo-sdk.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Code2, MessageSquare } from "lucide-react";
import type { V2EditorRef } from "@charisol/plexo-sdk/v2";
import type { DesignSystem, PageDefinition } from "@charisol/plexo-sdk/v2/compile";
import { appsApi, ApiError, type DesignSave, type DesignSummary } from "./api";
import { createStrataAdapter } from "./strataAdapter";
import { C, Button, Notice } from "./ui";
import { BLANK_TEMPLATE, defaultPageName, defaultRoute, freeRoute, pageFromTemplate, slugForName, templates } from "@/lib/projects/designTemplates";

const CODE_CHANGED_NOTE = "This page was changed in code since you last designed it. Saving here replaces those code changes.";

/** How each ready-made page looks on its card. Templates not listed here still get a card, with the default look. */
const PICK_LOOKS: Record<string, { hint: string; accent: string; bg: string }> = {
  home: { hint: "A welcoming front page for your site", accent: "#8b5cf6", bg: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(236,72,153,0.1))" },
  landing: { hint: "One page that sells, from hello to sign-up", accent: "#8b5cf6", bg: "linear-gradient(135deg, rgba(139,92,246,0.28), rgba(192,132,252,0.12))" },
  about: { hint: "Your story, your numbers and your team", accent: "#a78bfa", bg: "linear-gradient(135deg, rgba(167,139,250,0.22), rgba(109,40,217,0.08))" },
  services: { hint: "What you offer and how it works", accent: "#06b6d4", bg: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(99,102,241,0.1))" },
  pricing: { hint: "Plans side by side", accent: "#6366f1", bg: "linear-gradient(135deg, rgba(99,102,241,0.22), rgba(196,181,253,0.08))" },
  contact: { hint: "A way to get in touch", accent: "#7c3aed", bg: "linear-gradient(135deg, rgba(124,58,237,0.24), rgba(139,92,246,0.08))" },
  blank: { hint: "Start from nothing", accent: "#94a3b8", bg: "rgba(255,255,255,0.02)" },
};
const DEFAULT_LOOK = { hint: "", accent: "#8b5cf6", bg: "linear-gradient(135deg, rgba(139,92,246,0.22), rgba(192,132,252,0.08))" };

// The Design tab: design app pages visually in the Plexo editor (<V2Editor> from
// @charisol/plexo-sdk/v2). Each design is one page; saving compiles it to real React code in
// src/plexo-canvas/ and adds its route (lib/projects/designs.ts), then the preview rebuilds.
// Saves happen on their own a moment after each change. The editor owns the design while it's
// open (it reads `pages` once on mount), so a different design is loaded by remounting it.

type SdkV2 = typeof import("@charisol/plexo-sdk/v2");
type StockKeys = { unsplash?: string; pexels?: string; pixabay?: string };
/** What's open in the editor. `key` changes whenever a different design is loaded (a remount). */
type Loaded = { key: number; pages?: PageDefinition[]; designSystem: DesignSystem };

const AUTOSAVE_MS = 1500;

export function DesignPane(props: {
  appId: string;
  refreshKey: number;
  stockKeys: StockKeys;
  /** A design was saved (its page code changed) — rebuild the preview. */
  onSaved: (message: string) => void;
  /** Full screen: the app's chat and top bar are hidden so the page gets the room. */
  fullScreen: boolean;
  onToggleFullScreen: () => void;
  /** Back to the list of apps. */
  onExit: () => void;
  onAskSol: (text: string) => void;
  onOpenCode: (path: string) => void;
  onPreview: (route: string) => void;
}) {
  const { appId, onSaved } = props;
  const [sdk, setSdk] = useState<SdkV2 | null>(null);
  const [sdkError, setSdkError] = useState(false);
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState<DesignSummary | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [name, setName] = useState("");
  const [route, setRoute] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [heads, setHeads] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notWired, setNotWired] = useState(false);
  // Autosave waits while the page address clashes with another design's.
  const [routeTaken, setRouteTaken] = useState(false);
  // A brand-new page: the editor is open on its starting design and it's being added to the app.
  const [adding, setAdding] = useState<{ name: string; route: string; templateId: string; from: string | null } | null>(null);
  const [strataOn, setStrataOn] = useState(false);

  const editorRef = useRef<V2EditorRef>(null);
  const editVersion = useRef(0);
  const systemVersion = useRef(0);
  const systemDirty = useRef(false);
  const saving = useRef(false);
  const currentRef = useRef<DesignSummary | null>(null);
  currentRef.current = current;
  // The app's design system as last saved — what a new page opens with.
  const designSystemRef = useRef<DesignSystem | null>(null);
  // What the open editor holds, to tell when SOL changed things behind it.
  const shownSystem = useRef("");
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const addingRef = useRef(false);
  addingRef.current = !!adding;
  const loadedRef = useRef(false);
  loadedRef.current = !!loaded;
  const strata = useMemo(() => createStrataAdapter({ appId }), [appId]);

  // The editor only runs in the browser; load it on first open.
  useEffect(() => {
    let cancelled = false;
    import("@charisol/plexo-sdk/v2")
      .then((mod) => !cancelled && setSdk(mod))
      .catch(() => !cancelled && setSdkError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Strata is only offered when this Plexo has it set up.
  useEffect(() => {
    let cancelled = false;
    void strata.available().then((on) => !cancelled && setStrataOn(on));
    return () => {
      cancelled = true;
    };
  }, [strata]);

  const loadList = useCallback(async () => {
    try {
      const { designs, designSystem } = await appsApi.designs(appId);
      setDesigns(designs);
      designSystemRef.current = designSystem;
      setLoadError(null);
      return designs;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load your designs.");
      return null;
    }
  }, [appId]);

  const markDirty = useCallback(() => {
    editVersion.current += 1;
    setDirty(true);
    setSaveState("idle");
  }, []);

  /** Opens a design in the editor (remounting it) and treats it as saved. */
  const mount = useCallback((pages: PageDefinition[] | undefined, designSystem: DesignSystem) => {
    editVersion.current = 0;
    systemVersion.current = 0;
    systemDirty.current = false;
    shownSystem.current = JSON.stringify(designSystem);
    setDirty(false);
    setSaveState("idle");
    setLoaded((l) => ({ key: (l?.key ?? 0) + 1, pages, designSystem }));
  }, []);

  const open = useCallback(
    async (slug: string, opts: { onlyIfClean?: boolean } = {}) => {
      try {
        const result = await appsApi.design(appId, slug);
        // Refreshing behind the owner's back must never replace edits they've made since.
        if (opts.onlyIfClean && (dirtyRef.current || saving.current || addingRef.current)) return;
        designSystemRef.current = result.designSystem;
        mount([result.page], result.designSystem);
        setCurrent(result.design);
        setName(result.design.name);
        setRoute(result.design.route);
        setProblem(null);
        setHeads([]);
        setNotWired(false);
        setConflict(result.design.codeEdited ? CODE_CHANGED_NOTE : null);
      } catch (err) {
        setProblem(err instanceof ApiError ? err.message : "Couldn't open that design.");
      }
    },
    [appId, mount],
  );

  // First load: the list, then the first design.
  useEffect(() => {
    if (!sdk) return;
    void loadList().then((list) => {
      if (list?.length && !currentRef.current) void open(list[0].slug);
    });
  }, [sdk, loadList, open]);

  // Code or SOL may have changed things. The page list always refreshes. The open editor owns its
  // design, so it's only reopened on the new version when the design changed on the server and
  // the owner has no unsaved edits — never over their work.
  useEffect(() => {
    if (!sdk || !props.refreshKey) return;
    void (async () => {
      const list = await loadList();
      if (!list) return;
      const cur = currentRef.current;
      if (!cur) {
        if (list.length && !addingRef.current && !loadedRef.current) void open(list[0].slug);
        return;
      }
      const latest = list.find((d) => d.slug === cur.slug);
      if (!latest || dirtyRef.current || saving.current) return;
      const styleChanged = JSON.stringify(designSystemRef.current) !== shownSystem.current;
      if (latest.updatedAt !== cur.updatedAt || latest.codeEdited !== cur.codeEdited || styleChanged) void open(cur.slug, { onlyIfClean: true });
    })();
    // Runs when SOL or the code changes something (refreshKey), not when callbacks change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refreshKey, sdk]);

  const afterSave = useCallback(
    (result: { design: DesignSummary; routesWired: boolean; skipped: string[]; warnings: string[] }, systemSent: DesignSystem | undefined, version: number, sysVersion: number) => {
      setCurrent(result.design);
      setRoute(result.design.route);
      setDesigns((list) => (list?.some((d) => d.slug === result.design.slug) ? list.map((d) => (d.slug === result.design.slug ? result.design : d)) : [...(list ?? []), result.design].sort((a, b) => a.route.localeCompare(b.route))));
      setConflict(null);
      setRouteTaken(false);
      setProblem(result.skipped.length ? `Your style changes weren't applied to ${result.skipped.length === 1 ? "one page" : `${result.skipped.length} pages`} that were changed in code, so those pages stay as they are.` : null);
      setHeads(result.warnings ?? []);
      setNotWired(!result.routesWired);
      if (systemSent) {
        designSystemRef.current = systemSent;
        shownSystem.current = JSON.stringify(systemSent);
        if (systemVersion.current === sysVersion) systemDirty.current = false;
      }
      if (editVersion.current === version) {
        setDirty(false);
        setSaveState("saved");
      } else {
        setSaveState("idle");
      }
    },
    [],
  );

  const reportSaveError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.extra?.code === "code_edited") {
      setSaveState("idle");
      setConflict(err.message);
    } else if (err instanceof ApiError && err.extra?.code === "route_taken") {
      setSaveState("idle");
      setRouteTaken(true);
      setProblem(err.message);
    } else {
      setSaveState("error");
      setProblem(err instanceof ApiError ? err.message : "Couldn't save the design. Your changes are still here — try again.");
    }
  }, []);

  const save = useCallback(
    async (opts: { overwrite?: boolean } = {}) => {
      const design = currentRef.current;
      const editor = editorRef.current;
      if (!design || !editor || saving.current) return;
      saving.current = true;
      const version = editVersion.current;
      const sysVersion = systemVersion.current;
      setSaveState("saving");
      try {
        // Straight from the editor, so edits it hasn't reported yet aren't left out.
        const page = editor.getPages()[0];
        const body: DesignSave & { overwrite?: boolean } = { name: name.trim() || design.name, route, page, overwrite: opts.overwrite };
        const designSystem = systemDirty.current ? editor.getDesignSystem() : undefined;
        if (designSystem) body.designSystem = designSystem;
        const result = await appsApi.saveDesign(appId, design.slug, body);
        afterSave(result, designSystem, version, sysVersion);
        onSaved(`Edited the ${result.design.name} design`);
      } catch (err) {
        reportSaveError(err);
      } finally {
        saving.current = false;
      }
    },
    [appId, name, route, afterSave, reportSaveError, onSaved],
  );

  // Autosave a moment after the last change (not while a code conflict waits for a decision).
  useEffect(() => {
    if (!dirty || !current || conflict || routeTaken) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, current, conflict, routeTaken, save]);

  // A new page: open the editor on its starting design (blank, or one of the SDK's page templates), then
  // add it to the app as soon as the editor is up. From there it autosaves like any design.
  const startPage = (request: { name: string; route: string; templateId: string }) => {
    if (!sdk || adding) return;
    const ds = designSystemRef.current ?? loaded?.designSystem;
    if (!ds) return;
    const pageName = request.name.trim() || "New page";
    setProblem(null);
    setHeads([]);
    setConflict(null);
    setNotWired(false);
    setRouteTaken(false);
    // Nothing is "open" until the page exists, so a stray autosave can't land on the previous design.
    const from = currentRef.current?.slug ?? null;
    currentRef.current = null;
    setCurrent(null);
    setName(pageName);
    setRoute(request.route);
    setAdding({ ...request, name: pageName, from });
    // Seeded with the new page's own address so two pages from one template never share ids.
    const seeded = pageFromTemplate(request.templateId, { name: pageName, slug: slugForName(pageName, designs?.map((d) => d.slug) ?? []), designSystem: ds });
    mount(seeded ? [seeded] : undefined, ds);
  };

  useEffect(() => {
    if (!adding || !loaded) return;
    let cancelled = false;
    let tries = 0;
    const attempt = async () => {
      const editor = editorRef.current;
      if (!editor) {
        if (!cancelled && tries++ < 40) setTimeout(() => void attempt(), 50);
        return;
      }
      const version = editVersion.current;
      try {
        const result = await appsApi.createDesign(appId, { name: adding.name, route: adding.route, page: editor.getPages()[0] });
        if (cancelled) return;
        setName(result.design.name);
        setAdding(null);
        afterSave(result, undefined, version, systemVersion.current);
        onSaved(`Added the ${result.design.name} page`);
      } catch (err) {
        if (cancelled) return;
        setAdding(null);
        setProblem(err instanceof ApiError ? err.message : "Couldn't create the page.");
        // Back to what was open before (or the starting choices).
        if (adding.from) void open(adding.from);
        else setLoaded(null);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
    };
    // Runs once per new page: the editor it waits for is the one just mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, loaded?.key]);

  const remove = async () => {
    if (!current || !window.confirm(`Delete the "${current.name}" design and its page (${current.route})? You can bring it back from History.`)) return;
    try {
      await appsApi.deleteDesign(appId, current.slug);
      onSaved(`Removed the ${current.name} page`);
      setCurrent(null);
      setLoaded(null);
      const list = await loadList();
      if (list?.length) void open(list[0].slug);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "Couldn't delete the design.");
    }
  };

  const switchTo = async (slug: string) => {
    if (slug === current?.slug) return;
    if (dirty) await save();
    void open(slug);
  };

  const uploadImage = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new Error(data?.error ?? "Upload failed");
    return data.url as string;
  }, []);

  const providers = [
    props.stockKeys.unsplash ? { id: "unsplash", label: "Unsplash" } : null,
    props.stockKeys.pexels ? { id: "pexels", label: "Pexels" } : null,
    props.stockKeys.pixabay ? { id: "pixabay", label: "Pixabay" } : null,
  ].filter((p): p is { id: string; label: string } => !!p);

  const searchStock = useCallback(
    async (query: string, provider: string) => {
      const headers: Record<string, string> = {};
      if (props.stockKeys.unsplash) headers["x-unsplash-key"] = props.stockKeys.unsplash;
      if (props.stockKeys.pexels) headers["x-pexels-key"] = props.stockKeys.pexels;
      if (props.stockKeys.pixabay) headers["x-pixabay-key"] = props.stockKeys.pixabay;
      const res = await fetch(`/api/v1/media/stock?query=${encodeURIComponent(query)}&provider=${encodeURIComponent(provider)}`, { headers });
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data.map((r) => ({ id: r.id, src: r.src, alt: r.alt, credit: r.credit, provider: r.provider })) : [];
    },
    [props.stockKeys],
  );

  // ------------------------------------------------------------------ render

  if (sdkError) return <Centered><Notice tone="danger">The design canvas couldn't load. Check your connection and reload the page.</Notice></Centered>;
  if (!sdk || (!designs && !loadError)) return <Centered><span style={{ color: C.muted, fontSize: "0.82rem" }}>Loading the design canvas…</span></Centered>;
  if (loadError) return <Centered><Notice tone="danger">{loadError}</Notice></Centered>;

  // A page address that no other page of this app already uses.
  const taken = designs!.map((d) => d.route);
  const startFrom = (templateId: string, name = defaultPageName(templateId)) => startPage({ name, route: freeRoute(taken, defaultRoute(templateId, name)), templateId });

  if (!loaded && designs!.length) return <Centered><span style={{ color: C.muted, fontSize: "0.82rem" }}>Opening your design…</span></Centered>;

  if (!loaded) {
    const busyWith = adding?.name ?? null;
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>
        <div style={{ padding: "clamp(1.3rem, 5vw, 2.75rem) clamp(1rem, 5vw, 3rem) 3rem", display: "flex", flexDirection: "column", gap: "2.25rem" }}>
          <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: "clamp(1.3rem, 5.2vw, 1.75rem)", fontWeight: 750, letterSpacing: "-0.02em" }}>Design a page your way</h2>
            <p style={{ margin: 0, fontSize: "0.95rem", color: C.muted, lineHeight: 1.6, maxWidth: 640 }}>
              Pick a starting point. You&rsquo;ll drag in sections, text, images and buttons, and everything saves as you go.
            </p>
          </header>
          {problem && <Notice tone="danger">{problem}</Notice>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 22 }}>
            {templates().map((tpl) => {
              const look = PICK_LOOKS[tpl.id] ?? { ...DEFAULT_LOOK, hint: tpl.description };
              const pickName = defaultPageName(tpl.id);
              const busy = busyWith === pickName;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  className="design-pick"
                  disabled={!!busyWith}
                  onClick={() => startFrom(tpl.id)}
                  style={{
                    position: "relative",
                    textAlign: "left",
                    padding: 0,
                    borderRadius: 18,
                    overflow: "hidden",
                    cursor: busyWith ? "default" : "pointer",
                    color: C.text,
                    background: C.panel,
                    border: `1px solid ${busy ? "rgba(139,92,246,0.6)" : C.border}`,
                    opacity: busyWith && !busy ? 0.5 : 1,
                  }}
                >
                  <div style={{ height: 168, padding: 18, background: look.bg, borderBottom: `1px solid ${C.border}` }}>
                    <PickThumb kind={tpl.id} accent={look.accent} />
                  </div>
                  <div style={{ padding: "1rem 1.1rem 1.15rem" }}>
                    <div style={{ fontSize: "0.98rem", fontWeight: 700 }}>{busy ? "Setting it up…" : pickName}</div>
                    <div style={{ fontSize: "0.8rem", color: C.muted, marginTop: 4 }}>{look.hint}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <p style={{ margin: 0, fontSize: "0.8rem", color: C.faint }}>You can rename any page or change its web address later.</p>
        </div>
        <style>{`.design-pick { transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s; } .design-pick:not(:disabled):hover { transform: translateY(-3px); border-color: rgba(139,92,246,0.55) !important; box-shadow: 0 16px 40px rgba(139,92,246,0.18); } @media (prefers-reduced-motion: reduce) { .design-pick:hover { transform: none !important; } }`}</style>
      </div>
    );
  }

  const fieldStyle = { padding: "0.3rem 0.5rem", borderRadius: 8, border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit", fontSize: "0.78rem" } as const;
  const V2Editor = sdk.V2Editor;
  const askAbout = current ? `the "${current.name}" design, page ${current.route}` : "this new page";

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {(conflict || problem || notWired || heads.length > 0) && (
        <div style={{ padding: "0.5rem 0.8rem", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${C.border}` }}>
          {conflict && current && (
            <Notice tone="warning">
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 220 }}>{conflict}</span>
                <Button size="sm" variant="primary" onClick={() => void save({ overwrite: true })}>Use the design</Button>
                <Button size="sm" variant="ghost" onClick={() => props.onOpenCode(current.codeFile)}>
                  <Code2 size={13} /> Keep the code changes
                </Button>
              </span>
            </Notice>
          )}
          {problem && <Notice tone="danger">{problem}</Notice>}
          {heads.length > 0 && <Notice tone="info">{heads.slice(0, 3).join(" ")}</Notice>}
          {notWired && current && (
            <Notice tone="info">
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 220 }}>This page isn't linked into your app yet, so visitors can't reach {current.route}.</span>
                <Button size="sm" onClick={() => props.onAskSol(`Show my designed pages in the app: render the routes exported as designRoutes from src/plexo-canvas/routes.tsx inside <Routes> in src/App.tsx (before the catch-all route), then rebuild.`)}>
                  <MessageSquare size={13} /> Ask SOL to link it
                </Button>
              </span>
            </Notice>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <V2Editor
            key={loaded.key}
            ref={editorRef}
            pages={loaded.pages}
            designSystem={loaded.designSystem}
            onChange={() => markDirty()}
            onDesignSystemChange={() => {
              systemVersion.current += 1;
              systemDirty.current = true;
              markDirty();
            }}
            // Ask SOL in the editor is the real SOL: the question goes to the editor's SOL chat
            // (with the selected element and this page), where SOL answers and makes changes.
            onAskSol={async (question, context) => {
              const about = context.nodeType ? ` (about the selected ${context.nodeType.toLowerCase()} on ${askAbout})` : ` (on ${askAbout})`;
              props.onAskSol(`${question}${about}`);
              return "I've picked this up in the chat on the left — I'll answer there and make any change to the design.";
            }}
            onUpload={uploadImage}
            stockImages={providers.length ? { providers, search: searchStock } : undefined}
            strata={strataOn ? strata : undefined}
            onSave={() => save()}
            saveState={saveState === "saving" || saveState === "error" || saveState === "saved" ? saveState : dirty ? "dirty" : "idle"}
            // Pages belong to this app: it keeps the list and opens one design per page, so the editor shows ours.
            pageSource={{
              pages: designs!.map((d) => ({ id: d.slug, name: d.name, route: d.route })),
              currentId: current?.slug,
              onSelect: (slug) => switchTo(slug),
              onCreate: ({ name: pageName, templateId }) => startFrom(templateId, pageName.trim() || defaultPageName(templateId)),
              onDelete: () => remove(),
            }}
            shell={{
              onExit: props.onExit,
              exitLabel: "My apps",
              sidebarHidden: props.fullScreen,
              onToggleSidebar: props.onToggleFullScreen,
              hideLabel: "Full screen",
              showLabel: "Show chat",
            }}
            headerLeft={
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <input aria-label="Page name" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} style={{ ...fieldStyle, width: 130 }} />
                <input aria-label="Page address" title="Use / to make this your home page (it replaces the current one)" value={route} onChange={(e) => { setRoute(e.target.value); setRouteTaken(false); markDirty(); }} style={{ ...fieldStyle, width: 110, fontFamily: C.mono }} />
                <button type="button" title="Delete this design" aria-label="Delete this design" disabled={!current} onClick={() => void remove()} style={{ ...fieldStyle, cursor: "pointer", display: "inline-flex" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            }
            headerRight={
              current ? (
                <button type="button" onClick={() => props.onPreview(current.route)} title="See this page in your running app" style={{ ...fieldStyle, cursor: "pointer" }}>
                  View in app
                </button>
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

/** A small drawing of each kind of page, so the choice is visual. */
function PickThumb({ kind, accent }: { kind: string; accent: string }) {
  const line = (w: string, o = 0.35, h = 6) => <span style={{ display: "block", width: w, height: h, borderRadius: 99, background: `rgba(255,255,255,${o})` }} />;
  const frame: React.CSSProperties = { height: "100%", borderRadius: 10, background: "rgba(11,15,25,0.55)", border: "1px solid rgba(255,255,255,0.08)", padding: 12, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" };
  if (kind === BLANK_TEMPLATE)
    return (
      <div style={{ ...frame, border: "1.5px dashed rgba(255,255,255,0.16)", background: "transparent", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}>
          <Plus size={20} />
        </span>
      </div>
    );
  return (
    <div style={frame}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {line("22%", 0.5)}
        <span style={{ display: "flex", gap: 5 }}>{line("14px", 0.2, 4)}{line("14px", 0.2, 4)}{line("14px", 0.2, 4)}</span>
      </div>
      {(kind === "landing" || kind === "home") && (
        <>
          <div style={{ flex: 1, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, #c084fc)`, padding: 10, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
            {line("60%", 0.9, 8)}
            {line("40%", 0.55, 5)}
            <span style={{ width: 44, height: 14, borderRadius: 5, background: "#fff", marginTop: 2 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>{[0, 1, 2].map((i) => <span key={i} style={{ height: 16, borderRadius: 5, background: "rgba(255,255,255,0.08)" }} />)}</div>
        </>
      )}
      {kind === "services" && (
        <>
          {line("48%", 0.6, 7)}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ borderRadius: 7, padding: 7, display: "flex", flexDirection: "column", gap: 5, background: "rgba(255,255,255,0.06)" }}>
                <span style={{ width: 14, height: 14, borderRadius: 5, background: accent }} />
                {line("70%", 0.35, 4)}
                {line("50%", 0.2, 3)}
              </div>
            ))}
          </div>
        </>
      )}
      {kind === "about" && (
        <>
          {line("50%", 0.6, 7)}
          {line("80%", 0.2, 4)}
          {line("70%", 0.2, 4)}
          <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
            {[accent, "#6d28d9", "#c4b5fd"].map((c) => <span key={c} style={{ width: 26, height: 26, borderRadius: 99, background: c }} />)}
          </div>
        </>
      )}
      {kind === "pricing" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ borderRadius: 7, padding: 7, display: "flex", flexDirection: "column", gap: 5, background: i === 1 ? accent : "rgba(255,255,255,0.06)" }}>
              {line("50%", i === 1 ? 0.9 : 0.4, 5)}
              <span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>${[9, 29, 99][i]}</span>
              {line("80%", 0.25, 3)}
              {line("60%", 0.25, 3)}
            </div>
          ))}
        </div>
      )}
      {kind === "contact" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {line("45%", 0.6, 7)}
          {[0, 1].map((i) => <span key={i} style={{ height: 14, borderRadius: 5, border: "1px solid rgba(255,255,255,0.18)" }} />)}
          <span style={{ flex: 1, minHeight: 16, borderRadius: 5, border: "1px solid rgba(255,255,255,0.18)" }} />
          <span style={{ width: 52, height: 14, borderRadius: 5, background: accent }} />
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>{children}</div>;
}
