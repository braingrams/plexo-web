"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Code2, MessageSquare, Palette, MousePointer2, Link2, FileCode2 } from "lucide-react";
import { appsApi, ApiError, type DesignSummary } from "./api";
import { C, Button, Notice, inputStyle } from "./ui";

// The Design tab: design app pages visually on the Plexo canvas (@charisol/plexo-sdk/v2).
// Each design is one page; saving compiles it to real React code in src/plexo-canvas/ and
// adds its route (lib/projects/designs.ts), then the preview rebuilds. Saves happen on their
// own a moment after each change.

type SdkV2 = typeof import("@charisol/plexo-sdk/v2");
type StockKeys = { unsplash?: string; pexels?: string; pixabay?: string };

const AUTOSAVE_MS = 1500;
const BRAND_FIELDS = ["colors", "buttonSets", "activeButtonSetId", "boxSets", "activeBoxSetId", "textStyleSets", "activeTextStyleSetId"] as const;

function routeFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/${slug || "page"}`;
}

export function DesignPane(props: {
  appId: string;
  refreshKey: number;
  stockKeys: StockKeys;
  /** A design was saved (its page code changed) — rebuild the preview. */
  onSaved: (message: string) => void;
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
  const [name, setName] = useState("");
  const [route, setRoute] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notWired, setNotWired] = useState(false);
  // Autosave waits while the page address clashes with another design's.
  const [routeTaken, setRouteTaken] = useState(false);
  const [creating, setCreating] = useState<{ name: string; route: string; busy: boolean } | null>(null);

  const hydrating = useRef(false);
  const editVersion = useRef(0);
  const saving = useRef(false);
  const currentRef = useRef<DesignSummary | null>(null);
  currentRef.current = current;

  // The canvas only runs in the browser; load it on first open.
  useEffect(() => {
    let cancelled = false;
    import("@charisol/plexo-sdk/v2")
      .then((mod) => !cancelled && setSdk(mod))
      .catch(() => !cancelled && setSdkError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadList = useCallback(async () => {
    try {
      const { designs } = await appsApi.designs(appId);
      setDesigns(designs);
      setLoadError(null);
      return designs;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load your designs.");
      return null;
    }
  }, [appId]);

  const markDirty = useCallback(() => {
    if (hydrating.current || !currentRef.current) return;
    editVersion.current += 1;
    setDirty(true);
    setSaveState("idle");
  }, []);

  // Any change on the canvas or the brand kit marks the design unsaved.
  useEffect(() => {
    if (!sdk) return;
    const offCanvas = sdk.useCanvasStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes || s.pageOrder !== prev.pageOrder) markDirty();
    });
    const offBrand = sdk.useBrandStore.subscribe(() => markDirty());
    return () => {
      offCanvas();
      offBrand();
    };
  }, [sdk, markDirty]);

  const loadIntoCanvas = useCallback(
    (nodes: Record<string, unknown>, pageOrder: string[], brand: Record<string, unknown> | null) => {
      if (!sdk) return;
      hydrating.current = true;
      if (brand) sdk.useBrandStore.setState(brand as never);
      sdk.useCanvasStore.getState().hydrate(nodes as never, pageOrder);
      hydrating.current = false;
      editVersion.current = 0;
      setDirty(false);
      setSaveState("idle");
    },
    [sdk],
  );

  const open = useCallback(
    async (slug: string) => {
      if (!sdk) return;
      try {
        const loaded = await appsApi.design(appId, slug);
        loadIntoCanvas(loaded.nodes, loaded.pageOrder, loaded.brand);
        setCurrent(loaded.design);
        setName(loaded.design.name);
        setRoute(loaded.design.route);
        setProblem(null);
        setNotWired(false);
        setConflict(loaded.design.codeEdited ? `${loaded.design.codeFile.split("/").pop()} was edited in code since this design was last saved. Saving the design replaces those code changes.` : null);
      } catch (err) {
        setProblem(err instanceof ApiError ? err.message : "Couldn't open that design.");
      }
    },
    [appId, sdk, loadIntoCanvas],
  );

  // No designs yet: the empty state shows the new-page form straight away.
  useEffect(() => {
    if (designs && designs.length === 0 && !creating) setCreating({ name: "Landing page", route: "/landing-page", busy: false });
  }, [designs, creating]);

  // First load: the list, then the first design.
  useEffect(() => {
    if (!sdk) return;
    void loadList().then((list) => {
      if (list?.length && !currentRef.current) void open(list[0].slug);
    });
  }, [sdk, loadList, open]);

  // Code or SOL may have changed things — refresh the list (not the open canvas, which may hold edits).
  useEffect(() => {
    if (sdk && props.refreshKey) void loadList();
  }, [props.refreshKey, sdk, loadList]);

  const brandSnapshot = useCallback(() => {
    const state = sdk!.useBrandStore.getState() as unknown as Record<string, unknown>;
    return Object.fromEntries(BRAND_FIELDS.map((k) => [k, state[k]]));
  }, [sdk]);

  const save = useCallback(
    async (opts: { overwrite?: boolean } = {}) => {
      const design = currentRef.current;
      if (!sdk || !design || saving.current) return;
      saving.current = true;
      const version = editVersion.current;
      setSaveState("saving");
      try {
        const { nodes, pageOrder } = sdk.useCanvasStore.getState();
        const result = await appsApi.saveDesign(appId, design.slug, { name: name.trim() || design.name, route, nodes, pageOrder, brand: brandSnapshot(), overwrite: opts.overwrite });
        setCurrent(result.design);
        setRoute(result.design.route);
        setDesigns((list) => list?.map((d) => (d.slug === result.design.slug ? result.design : d)) ?? list);
        setConflict(null);
        setRouteTaken(false);
        setProblem(result.skipped.length ? `Brand changes weren't applied to ${result.skipped.join(", ")} — their code was edited by hand.` : null);
        setNotWired(!result.routesWired);
        if (editVersion.current === version) {
          setDirty(false);
          setSaveState("saved");
        } else {
          setSaveState("idle");
        }
        onSaved(`Edited the ${result.design.name} design`);
      } catch (err) {
        setSaveState("idle");
        if (err instanceof ApiError && err.extra?.code === "code_edited") setConflict(err.message);
        else if (err instanceof ApiError && err.extra?.code === "route_taken") {
          setRouteTaken(true);
          setProblem(err.message);
        } else setProblem(err instanceof ApiError ? err.message : "Couldn't save the design. Your changes are still here — try again.");
      } finally {
        saving.current = false;
      }
    },
    [appId, sdk, name, route, brandSnapshot, onSaved],
  );

  // Autosave a moment after the last change (not while a code conflict waits for a decision).
  useEffect(() => {
    if (!dirty || conflict || routeTaken) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, conflict, routeTaken, save]);

  const create = async () => {
    if (!sdk || !creating) return;
    const pageName = creating.name.trim() || "New page";
    setCreating({ ...creating, busy: true });
    try {
      // A new page starts from the canvas's starter layout, ready to edit.
      hydrating.current = true;
      sdk.useCanvasStore.getState().hydrate({}, []);
      sdk.useCanvasStore.getState().seed();
      hydrating.current = false;
      const { nodes, pageOrder } = sdk.useCanvasStore.getState();
      const result = await appsApi.createDesign(appId, { name: pageName, route: creating.route, nodes, pageOrder, brand: brandSnapshot() });
      setDesigns((list) => [...(list ?? []), result.design].sort((a, b) => a.route.localeCompare(b.route)));
      setCurrent(result.design);
      setName(result.design.name);
      setRoute(result.design.route);
      setDirty(false);
      setConflict(null);
      setProblem(null);
      setNotWired(!result.routesWired);
      setCreating(null);
      onSaved(`Added the ${result.design.name} page`);
      props.onPreview(result.design.route);
    } catch (err) {
      hydrating.current = false;
      setCreating({ ...creating, busy: false });
      setProblem(err instanceof ApiError ? err.message : "Couldn't create the page.");
      if (currentRef.current) void open(currentRef.current.slug);
    }
  };

  const remove = async () => {
    if (!current || !window.confirm(`Delete the "${current.name}" design and its page (${current.route})? You can bring it back from History.`)) return;
    try {
      await appsApi.deleteDesign(appId, current.slug);
      onSaved(`Removed the ${current.name} page`);
      setCurrent(null);
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
      return Array.isArray(data) ? data.map((r) => ({ id: r.id, src: r.src, alt: r.alt, credit: r.credit, photographerUrl: r.photographerUrl, provider: r.provider })) : [];
    },
    [props.stockKeys],
  );

  // ------------------------------------------------------------------ render

  if (sdkError) return <Centered><Notice tone="danger">The design canvas couldn't load. Check your connection and reload the page.</Notice></Centered>;
  if (!sdk || (!designs && !loadError)) return <Centered><span style={{ color: C.muted, fontSize: "0.82rem" }}>Loading the design canvas…</span></Centered>;
  if (loadError) return <Centered><Notice tone="danger">{loadError}</Notice></Centered>;

  const newPageForm = creating && (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={{ fontSize: "0.76rem", color: C.muted }}>
          Page name
          <input autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value, route: routeFromName(e.target.value) })} placeholder="About us" style={{ ...inputStyle, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: "0.76rem", color: C.muted }}>
          Page address
          <input value={creating.route} onChange={(e) => setCreating({ ...creating, route: e.target.value })} placeholder="/about" style={{ ...inputStyle, marginTop: 4, fontFamily: C.mono }} />
          <span style={{ display: "block", marginTop: 4, color: C.faint }}>Use / to make this design your home page (it replaces the current one).</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" disabled={creating.busy}>
          {creating.busy ? "Creating…" : "Create page"}
        </Button>
        {designs!.length > 0 && (
          <Button type="button" variant="ghost" onClick={() => setCreating(null)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  if (!designs!.length || !current) {
    const howItWorks = [
      { icon: MousePointer2, title: "Drag, drop and style", body: "Sections, text, images, buttons, forms and menus on a canvas — with your brand's fonts and colours." },
      { icon: FileCode2, title: "Real React code", body: "Each design becomes a page in src/plexo-canvas/. SOL, Code mode and GitHub all see it." },
      { icon: Link2, title: "Its own address", body: "Pick where the page lives, like /pricing. Plexo adds it to your app for you." },
    ];
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "1.5rem" }}>
        <div className="design-empty-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 24, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(139,92,246,0.15)" }}>
                <Palette size={20} color={C.brand} />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Design a page visually</div>
                <div style={{ fontSize: "0.82rem", color: C.muted, marginTop: 4, maxWidth: 640 }}>
                  Lay a page out on the canvas and Plexo turns it into real React code in your app. Start with a page name and address — you can change both later.
                </div>
              </div>
            </div>
            {problem && <Notice tone="danger">{problem}</Notice>}
            <div style={{ padding: "1.1rem", borderRadius: 14, border: `1px solid ${C.border}`, background: C.panel }}>{newPageForm}</div>
          </div>
          <aside style={{ padding: "1.1rem", borderRadius: 14, border: `1px solid ${C.border}`, background: C.panel, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>How designs work</div>
            {howItWorks.map(({ icon: Icon, title, body }) => (
              <div key={title} style={{ display: "flex", gap: 12 }}>
                <Icon size={17} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: "0.84rem", fontWeight: 650 }}>{title}</div>
                  <div style={{ fontSize: "0.77rem", color: C.muted, lineHeight: 1.45 }}>{body}</div>
                </div>
              </div>
            ))}
          </aside>
        </div>
        <style>{`@media (max-width: 1000px) { .design-empty-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
      </div>
    );
  }

  const fieldStyle = { padding: "0.3rem 0.5rem", borderRadius: 8, border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit", fontSize: "0.78rem" } as const;
  const V2Canvas = sdk.V2Canvas;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {(conflict || problem || notWired) && (
        <div style={{ padding: "0.5rem 0.8rem", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${C.border}` }}>
          {conflict && (
            <Notice tone="warning">
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 220 }}>{conflict}</span>
                <Button size="sm" variant="primary" onClick={() => void save({ overwrite: true })}>Use the design</Button>
                <Button size="sm" variant="ghost" onClick={() => props.onOpenCode(current.codeFile)}>
                  <Code2 size={13} /> Keep the code
                </Button>
              </span>
            </Notice>
          )}
          {problem && <Notice tone="danger">{problem}</Notice>}
          {notWired && (
            <Notice tone="info">
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 220 }}>Your App.tsx was changed, so Plexo couldn't add this page's address ({current.route}) automatically.</span>
                <Button size="sm" onClick={() => props.onAskSol(`Show my designed pages in the app: render the routes exported as designRoutes from src/plexo-canvas/routes.tsx inside <Routes> in src/App.tsx (before the catch-all route), then rebuild.`)}>
                  <MessageSquare size={13} /> Ask SOL to add it
                </Button>
              </span>
            </Notice>
          )}
        </div>
      )}
      {creating && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => e.target === e.currentTarget && !creating.busy && setCreating(null)}>
          <div style={{ background: C.panelSolid, border: `1px solid ${C.borderStrong}`, borderRadius: 14, padding: "1.2rem", width: "min(420px, 92vw)", color: C.text }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>New page</div>
            {newPageForm}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <V2Canvas
          // Ask SOL on the canvas is the real SOL: the question goes to the editor's SOL chat
          // (with the selected element and this page), where SOL answers and makes changes.
          onAskSol={async (question, context) => {
            const about = context.nodeType ? ` (about the selected ${context.nodeType.toLowerCase()} on the "${current.name}" design, page ${current.route})` : ` (on the "${current.name}" design, page ${current.route})`;
            props.onAskSol(`${question}${about}`);
            return "I've picked this up in the chat on the left — I'll answer there and make any change to the design.";
          }}
          onUploadImage={uploadImage}
          stockImageProviders={providers.length ? providers : undefined}
          onSearchStockImages={providers.length ? searchStock : undefined}
          onSave={() => void save()}
          saveState={saveState}
          headerLeftContent={
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <select aria-label="Page" value={current.slug} onChange={(e) => void switchTo(e.target.value)} style={{ ...fieldStyle, fontWeight: 600 }}>
                {designs!.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.name} ({d.route})
                  </option>
                ))}
              </select>
              <input aria-label="Page name" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} style={{ ...fieldStyle, width: 130 }} />
              <input aria-label="Page address" value={route} onChange={(e) => { setRoute(e.target.value); setRouteTaken(false); markDirty(); }} style={{ ...fieldStyle, width: 110, fontFamily: C.mono }} />
              <button type="button" title="New page" aria-label="New page" onClick={() => setCreating({ name: "New page", route: "/new-page", busy: false })} style={{ ...fieldStyle, cursor: "pointer", display: "inline-flex" }}>
                <Plus size={14} />
              </button>
              <button type="button" title="Delete this design" aria-label="Delete this design" onClick={() => void remove()} style={{ ...fieldStyle, cursor: "pointer", display: "inline-flex" }}>
                <Trash2 size={14} />
              </button>
            </div>
          }
          headerRightContent={
            <button type="button" onClick={() => props.onPreview(current.route)} title="See this page in your running app" style={{ ...fieldStyle, cursor: "pointer" }}>
              View in app
            </button>
          }
        />
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>{children}</div>;
}
