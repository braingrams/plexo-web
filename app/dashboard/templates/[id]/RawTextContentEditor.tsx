"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtractedTextNode } from "@/lib/htmlTextExtraction";
import type { ExtractedImageNode, ExtractedImgNode, ExtractedBackgroundNode } from "@/lib/htmlImageExtraction";
import { ScriptAccessControl } from "./ScriptAccessControl";

type Props = {
  templateId: string;
};

type ActiveField =
  | { kind: "text"; id: number }
  | { kind: "img"; id: number }
  | { kind: "background"; id: number }
  | null;

type ImgDraft = { src: string; width: number | null; height: number | null };
type BgDraft = { src: string; backgroundSize: string | null };

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

function IconLock({ locked }: { locked: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {locked ? (
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      ) : (
        <path d="M8 11V7a4 4 0 0 1 7.6-1.8" />
      )}
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Points left by default; pass "right" to mirror it — used for both panels' collapse/expand
 * affordances so only one shape needs maintaining. */
function IconChevron({ direction = "left" }: { direction?: "left" | "right" }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: direction === "right" ? "rotate(180deg)" : undefined }}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconDesktop() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function IconTablet() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

function IconMobile() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

type DeviceMode = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTHS: Record<DeviceMode, string> = {
  desktop: "100%",
  tablet: "820px",
  mobile: "390px",
};

const DEVICE_OPTIONS: Array<{ key: DeviceMode; icon: React.ReactNode; title: string }> = [
  { key: "desktop", icon: <IconDesktop />, title: "Desktop width" },
  { key: "tablet", icon: <IconTablet />, title: "Tablet width" },
  { key: "mobile", icon: <IconMobile />, title: "Mobile width" },
];

/** Segmented control that constrains the preview iframe's width so the page's own responsive
 * CSS reacts as it would at that viewport size — this only simulates viewport width, not a
 * real device (no touch/UA emulation), which is all "see what it looks like on mobile" needs
 * for a CSS-driven layout check. */
function DeviceToggle({ value, onChange }: { value: DeviceMode; onChange: (device: DeviceMode) => void }) {
  return (
    <div style={{ display: "flex", gap: "0.15rem", background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.15rem", flexShrink: 0 }}>
      {DEVICE_OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.key)}
            style={{
              display: "grid", placeItems: "center", width: 26, height: 22, borderRadius: 6, border: "none",
              background: active ? "rgba(139,92,246,0.4)" : "transparent",
              color: active ? "#fff" : "rgba(240,242,255,0.55)",
              cursor: "pointer",
            }}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

const BG_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  { value: "cover", label: "Cover (fill, cropped)" },
  { value: "contain", label: "Contain (fit, no crop)" },
  { value: "auto", label: "Auto (original size)" },
  { value: "100% 100%", label: "Stretch to fit" },
];

/** Custom-built dropdown instead of a native <select> — the native popup is drawn by the
 * OS/browser using its own light/dark heuristic, not this page's CSS, so it was popping
 * open unreadable (near-white text on a white background) regardless of color-scheme
 * hints. Rendering the option list ourselves guarantees it always matches the app's
 * dark theme. */
function BackgroundSizeSelect({
  value,
  onChange,
  onFocus,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = BG_SIZE_OPTIONS.find((o) => o.value === (value ?? "")) ?? BG_SIZE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => {
          onFocus();
          setOpen((v) => !v);
        }}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(255,255,255,0.04)",
          border: open ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: 7, color: "#f0f2ff", padding: "0.35rem 0.5rem", fontSize: "0.78rem",
          outline: "none", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        <span>{selected.label}</span>
        <span style={{ color: "rgba(240,242,255,0.4)", display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <IconChevronDown />
        </span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
          background: "rgba(18,16,36,0.98)", border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 8, overflow: "hidden", boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
        }}>
          {BG_SIZE_OPTIONS.map((opt) => {
            const isActive = opt.value === (value ?? "");
            return (
              <button
                key={opt.value || "default"}
                type="button"
                onClick={() => {
                  onChange(opt.value || null);
                  setOpen(false);
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.5rem 0.6rem", background: isActive ? "rgba(139,92,246,0.15)" : "transparent",
                  border: "none", color: isActive ? "#c4b5fd" : "rgba(240,242,255,0.8)",
                  fontSize: "0.78rem", fontWeight: isActive ? 600 : 400, textAlign: "left", cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {opt.label}
                {isActive && <IconCheck />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ATTR_FOR_KIND: Record<"text" | "img" | "background", string> = {
  text: "data-ptid",
  img: "data-pimg",
  background: "data-pbg",
};

/** Groups consecutive nodes under the same key so the list reads as sections rather than
 * one flat list — purely derived from whatever the extractor found (document order), no
 * hardcoded structure. Used both for grouping text fields by structural section ("Header",
 * "Hero", "Section 1"…) and, within a section, by field type ("Heading", "Button"…), plus
 * images/backgrounds by their own label. */
function groupBy<T>(nodes: T[], keyFn: (node: T) => string): { label: string; nodes: T[] }[] {
  const groups: { label: string; nodes: T[] }[] = [];
  for (const node of nodes) {
    const key = keyFn(node);
    const last = groups[groups.length - 1];
    if (last && last.label === key) {
      last.nodes.push(node);
    } else {
      groups.push({ label: key, nodes: [node] });
    }
  }
  return groups;
}

function findPreviewElements(doc: Document, kind: "text" | "img" | "background", id: number): HTMLElement[] {
  return Array.from(doc.querySelectorAll(`[${ATTR_FOR_KIND[kind]}~="${id}"]`));
}

export function RawTextContentEditor({ templateId }: Props) {
  const [nodes, setNodes] = useState<ExtractedTextNode[] | null>(null);
  const [imageNodes, setImageNodes] = useState<ExtractedImageNode[] | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [hrefDrafts, setHrefDrafts] = useState<Record<number, string>>({});
  const [imgDrafts, setImgDrafts] = useState<Record<number, ImgDraft>>({});
  const [bgDrafts, setBgDrafts] = useState<Record<number, BgDraft>>({});
  const [lockAspect, setLockAspect] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>(null);
  // True only during a staff-approved "full script preview" window (see ScriptAccessControl).
  // While true, the preview iframe drops allow-same-origin in favor of allow-scripts (opaque
  // origin, same safe pattern as the full "Preview" modal) — which means this component's own
  // DOM access into the iframe (highlight/scroll/live-patch/drag-resize) can't work, since that
  // needs allow-same-origin. See the effects/handlers below guarded on this flag.
  const [scriptsActive, setScriptsActive] = useState(false);
  // At most one side collapsed at a time — a single enum instead of two independent
  // booleans means "collapse the other side" while one is already collapsed just swaps
  // which one is hidden, rather than risking both collapsed and nothing visible.
  const [collapsedSide, setCollapsedSide] = useState<"none" | "fields" | "preview">("none");
  const [device, setDevice] = useState<DeviceMode>("desktop");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Registered by each field's wrapper element so a click inside the preview can scroll the
  // matching field into view in this list — the reverse direction of the highlight/scroll
  // effect below (which goes list -> preview). Keyed "kind-id" to share one map across text,
  // image, and background fields.
  const fieldRefs = useRef<Map<string, HTMLElement>>(new Map());
  function registerFieldRef(kind: "text" | "img" | "background", id: number) {
    const key = `${kind}-${id}`;
    return (el: HTMLElement | null) => {
      if (el) fieldRefs.current.set(key, el);
      else fieldRefs.current.delete(key);
    };
  }
  // State, not a ref: external images referenced by the previewed page can take a while to
  // finish loading, so the iframe's `load` event can fire well after a user has already
  // clicked a field. This needs to be state so the highlight/resize effect below re-runs
  // once it flips true — a ref wouldn't trigger that re-run, silently leaving early clicks
  // unhighlighted with no resize handle until the next field change.
  const [previewReady, setPreviewReady] = useState(false);
  const lockAspectRef = useRef(lockAspect);
  lockAspectRef.current = lockAspect;

  const imgNodes = (imageNodes?.filter((n) => n.kind === "img") ?? []) as ExtractedImgNode[];
  const bgNodes = (imageNodes?.filter((n) => n.kind === "background") ?? []) as ExtractedBackgroundNode[];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/v1/templates/${templateId}/text-content`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load text content.");
        return res.json();
      })
      .then((data: { nodes: ExtractedTextNode[]; imageNodes: ExtractedImageNode[]; previewHtml: string }) => {
        if (cancelled) return;
        setNodes(data.nodes);
        setImageNodes(data.imageNodes);
        setPreviewHtml(data.previewHtml);
        setDrafts(Object.fromEntries(data.nodes.map((n) => [n.id, n.text])));
        setHrefDrafts(
          Object.fromEntries(
            data.nodes.filter((n) => n.href !== undefined).map((n) => [n.id, n.href as string]),
          ),
        );
        const imgD: Record<number, ImgDraft> = {};
        const bgD: Record<number, BgDraft> = {};
        const lock: Record<number, boolean> = {};
        data.imageNodes.forEach((n) => {
          if (n.kind === "img") {
            imgD[n.id] = { src: n.src, width: n.width, height: n.height };
            lock[n.id] = true;
          } else {
            bgD[n.id] = { src: n.src, backgroundSize: n.backgroundSize };
          }
        });
        setImgDrafts(imgD);
        setBgDrafts(bgD);
        setLockAspect(lock);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load text content.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Highlight + scroll to whichever field is focused, and (for images) attach a drag-to-resize
  // handle directly onto the target element inside the iframe. Re-runs whenever the active
  // field OR previewReady changes, so a field clicked before the iframe finished loading
  // still gets highlighted/resizable as soon as it does.
  useEffect(() => {
    // An allow-scripts-without-allow-same-origin iframe (full script preview mode) is an
    // opaque origin — contentDocument access either throws or returns null, and there's
    // nothing to highlight/resize even if it didn't, so skip entirely while active.
    if (!previewReady || scriptsActive) return;
    const doc = iframeRef.current?.contentDocument;
    const win = iframeRef.current?.contentWindow;
    if (!doc || !win) return;

    doc.querySelectorAll(".plexo-active").forEach((el) => el.classList.remove("plexo-active"));
    doc.querySelectorAll("[data-plexo-resize-handle]").forEach((el) => el.remove());
    if (!activeField) return;

    const targets = findPreviewElements(doc, activeField.kind, activeField.id);
    targets.forEach((el) => el.classList.add("plexo-active"));
    targets[0]?.scrollIntoView({ behavior: "smooth", block: "center" });

    if (activeField.kind !== "img" || targets.length === 0) return;
    const target = targets[0] as HTMLImageElement;
    const nodeId = activeField.id;

    const handle = doc.createElement("div");
    handle.setAttribute("data-plexo-resize-handle", "1");
    Object.assign(handle.style, {
      position: "fixed",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      background: "#8b5cf6",
      border: "2px solid #fff",
      boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
      cursor: "nwse-resize",
      zIndex: "999999",
    } satisfies Partial<CSSStyleDeclaration>);

    function reposition() {
      const rect = target.getBoundingClientRect();
      handle.style.left = `${rect.right - 7}px`;
      handle.style.top = `${rect.bottom - 7}px`;
    }
    reposition();
    doc.body.appendChild(handle);

    // The handle sits right on the image's corner, overlapping it — without this, a
    // mousedown there can also kick off the browser's native "drag this image out"
    // gesture underneath, which fights with (and inside a script-restricted sandboxed
    // iframe, can outright crash the renderer on) the custom drag handling below.
    const previousDraggable = target.getAttribute("draggable");
    target.setAttribute("draggable", "false");
    function onDragStart(e: DragEvent) {
      e.preventDefault();
    }
    target.addEventListener("dragstart", onDragStart);

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    function onMouseDown(e: MouseEvent) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const r = target.getBoundingClientRect();
      startW = r.width;
      startH = r.height;
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newW = Math.max(16, Math.round(startW + dx));
      let newH = Math.max(16, Math.round(startH + dy));
      if (lockAspectRef.current[nodeId] && startW && startH) {
        newH = Math.round(newW * (startH / startW));
      }
      target.style.width = `${newW}px`;
      target.style.height = `${newH}px`;
      reposition();
      setImgDrafts((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], width: newW, height: newH } }));
    }
    function onMouseUp() {
      dragging = false;
    }

    handle.addEventListener("mousedown", onMouseDown);
    win.addEventListener("mousemove", onMouseMove);
    win.addEventListener("mouseup", onMouseUp);
    doc.addEventListener("scroll", reposition, true);

    return () => {
      handle.removeEventListener("mousedown", onMouseDown);
      win.removeEventListener("mousemove", onMouseMove);
      win.removeEventListener("mouseup", onMouseUp);
      doc.removeEventListener("scroll", reposition, true);
      target.removeEventListener("dragstart", onDragStart);
      if (previousDraggable === null) target.removeAttribute("draggable");
      else target.setAttribute("draggable", previousDraggable);
      handle.remove();
    };
  }, [activeField, previewReady, scriptsActive]);

  // Reverse direction: clicking an element in the preview scrolls (and, for text fields,
  // focuses) the matching field in the list on the left — same data-ptid/data-pimg/data-pbg
  // attributes the highlight effect above already reads, just consumed the other way. Also
  // unavailable during full script preview mode — see the effect above.
  useEffect(() => {
    if (!previewReady || scriptsActive) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    function onClick(e: MouseEvent) {
      // This is a static, non-interactive preview — a click on a link or submit button
      // should only ever scroll the matching field into view below, never actually follow
      // the href or submit a form (both of which are native browser behaviors that fire
      // regardless of allow-scripts, so they'd otherwise navigate the iframe away from the
      // preview entirely).
      e.preventDefault();
      const clicked = e.target as HTMLElement | null;
      if (!clicked) return;
      for (const kind of ["text", "img", "background"] as const) {
        const attr = ATTR_FOR_KIND[kind];
        const matched = clicked.closest(`[${attr}]`);
        if (!matched) continue;
        const firstId = Number((matched.getAttribute(attr) ?? "").split(" ")[0]);
        if (Number.isNaN(firstId)) return;
        setActiveField({ kind, id: firstId });
        const target = fieldRefs.current.get(`${kind}-${firstId}`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        const focusable = (target?.matches("input, textarea") ? target : target?.querySelector("input, textarea")) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null
          | undefined;
        focusable?.focus({ preventScroll: true });
        return;
      }
    }

    doc.addEventListener("click", onClick);
    return () => doc.removeEventListener("click", onClick);
  }, [previewReady, scriptsActive]);

  function handlePreviewLoad() {
    setPreviewReady(true);
  }

  function handleDraftChange(node: ExtractedTextNode, value: string) {
    setDrafts((prev) => ({ ...prev, [node.id]: value }));

    // Only live-patch the preview when this element's data-ptid is exactly this one id —
    // if it's shared with sibling text runs (space-separated), overwriting textContent
    // would blow away nested markup (e.g. "Some <a>link</a> text."), so leave those as
    // highlight-and-scroll only, not live-typed.
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !previewReady || scriptsActive) return;
    const target = doc.querySelector(`[data-ptid~="${node.id}"]`);
    if (target && target.getAttribute("data-ptid") === String(node.id)) {
      target.textContent = value;
    }
  }

  function handleHrefChange(node: ExtractedTextNode, value: string) {
    setHrefDrafts((prev) => ({ ...prev, [node.id]: value }));
  }

  function handleImgSrcChange(node: ExtractedImgNode, value: string) {
    setImgDrafts((prev) => ({ ...prev, [node.id]: { ...prev[node.id], src: value } }));
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !previewReady || scriptsActive) return;
    findPreviewElements(doc, "img", node.id).forEach((el) => {
      (el as HTMLImageElement).src = value;
    });
  }

  function handleImgSizeChange(node: ExtractedImgNode, dim: "width" | "height", raw: string) {
    const value = raw.trim() === "" ? null : Math.max(1, Math.round(Number(raw)));
    if (raw.trim() !== "" && Number.isNaN(value)) return;

    setImgDrafts((prev) => {
      const current = prev[node.id] ?? { src: node.src, width: node.width, height: node.height };
      const next: ImgDraft = { ...current, [dim]: value };
      if (lockAspect[node.id] && current.width && current.height && value !== null) {
        const ratio = current.height / current.width;
        if (dim === "width") next.height = Math.round(value * ratio);
        else next.width = Math.round(value / ratio);
      }

      const doc = iframeRef.current?.contentDocument;
      if (doc && previewReady && !scriptsActive) {
        findPreviewElements(doc, "img", node.id).forEach((el) => {
          const style = (el as HTMLImageElement).style;
          if (next.width !== null) style.width = `${next.width}px`;
          else style.removeProperty("width");
          if (next.height !== null) style.height = `${next.height}px`;
          else style.removeProperty("height");
        });
      }

      return { ...prev, [node.id]: next };
    });
  }

  function handleBgChange(node: ExtractedBackgroundNode, patch: Partial<BgDraft>) {
    setBgDrafts((prev) => ({ ...prev, [node.id]: { ...prev[node.id], ...patch } }));
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !previewReady || scriptsActive) return;
    findPreviewElements(doc, "background", node.id).forEach((el) => {
      const style = (el as HTMLElement).style;
      if (patch.src !== undefined) style.backgroundImage = `url("${patch.src}")`;
      if (patch.backgroundSize !== undefined) {
        if (patch.backgroundSize === null) style.removeProperty("background-size");
        else style.backgroundSize = patch.backgroundSize;
      }
    });
  }

  const textDirty =
    nodes?.some((n) => drafts[n.id] !== n.text || (n.href !== undefined && hrefDrafts[n.id] !== n.href)) ?? false;
  const imgDirty = imgNodes.some((n) => {
    const d = imgDrafts[n.id];
    return d && (d.src !== n.src || d.width !== n.width || d.height !== n.height);
  });
  const bgDirty = bgNodes.some((n) => {
    const d = bgDrafts[n.id];
    return d && (d.src !== n.src || d.backgroundSize !== n.backgroundSize);
  });
  const dirty = textDirty || imgDirty || bgDirty;

  async function handleSave() {
    if (!nodes) return;
    setSaving(true);
    setSaveError(null);
    try {
      const edits = nodes
        .filter((n) => drafts[n.id] !== n.text || (n.href !== undefined && hrefDrafts[n.id] !== n.href))
        .map((n) => ({
          id: n.id,
          text: drafts[n.id],
          ...(n.href !== undefined ? { href: hrefDrafts[n.id] ?? n.href } : {}),
        }));
      const imgEdits = imgNodes
        .filter((n) => {
          const d = imgDrafts[n.id];
          return d && (d.src !== n.src || d.width !== n.width || d.height !== n.height);
        })
        .map((n) => ({ id: n.id, ...imgDrafts[n.id] }));
      const backgroundEdits = bgNodes
        .filter((n) => {
          const d = bgDrafts[n.id];
          return d && (d.src !== n.src || d.backgroundSize !== n.backgroundSize);
        })
        .map((n) => ({ id: n.id, ...bgDrafts[n.id] }));

      const res = await fetch(`/api/v1/templates/${templateId}/text-content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits, imgEdits, backgroundEdits }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Save failed.");

      setNodes(
        (prev) =>
          prev?.map((n) => ({
            ...n,
            text: drafts[n.id] ?? n.text,
            ...(n.href !== undefined ? { href: hrefDrafts[n.id] ?? n.href } : {}),
          })) ?? null,
      );
      setImageNodes((prev) =>
        prev?.map((n) =>
          n.kind === "img"
            ? { ...n, ...imgDrafts[n.id] }
            : { ...n, ...bgDrafts[n.id] },
        ) ?? null,
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.4)" }}>
        Loading text content…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#f87171" }}>
        {loadError}
      </div>
    );
  }
  if ((!nodes || nodes.length === 0) && imgNodes.length === 0 && bgNodes.length === 0) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.4)" }}>
        No editable text or images found in this page.
      </div>
    );
  }

  const imgGroups = groupBy(imgNodes, (n) => n.label);
  const bgGroups = groupBy(bgNodes, (n) => n.label);
  // Two-level grouping for text fields: outer by structural section ("Header", "Hero",
  // "Section 1"…), inner by field type ("Heading", "Button"…) within that section.
  const sectionGroups = groupBy(nodes ?? [], (n) => n.section).map((sec) => ({
    ...sec,
    labelGroups: groupBy(sec.nodes, (n) => n.label),
  }));

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    color: "rgba(240,242,255,0.35)", marginBottom: "0.6rem",
  };
  const fieldLabelStyle: React.CSSProperties = { ...sectionHeadingStyle, marginBottom: "0.3rem" };
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "0.9rem", fontWeight: 800, color: "#f0f2ff", margin: "0 0 0.65rem",
    display: "flex", alignItems: "center", gap: "0.4rem",
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="raw-text-editor-header" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
          Every piece of visible text and every image on this page, grouped by where it sits on
          the page — edit and save without touching markup. Click a field to see exactly where
          it is on the page, or click the page to jump to its field.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
          {saveError && <span style={{ color: "#f87171", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}><IconWarning /> {saveError}</span>}
          {savedFlash && <span style={{ color: "#34d399", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}><IconCheck /> Saved</span>}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
            className="btn-primary"
            style={{
              padding: "0.45rem 1.1rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              border: "none", color: "#fff",
              cursor: !dirty || saving ? "default" : "pointer",
              opacity: !dirty || saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{
        padding: "0.5rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <ScriptAccessControl
          templateId={templateId}
          onModeChange={(active) => {
            setPreviewReady(false);
            setScriptsActive(active);
          }}
        />
      </div>

      <div className="raw-text-editor-split" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          className={collapsedSide === "fields" ? "raw-text-editor-collapsed-strip" : undefined}
          style={
            collapsedSide === "fields"
              ? { width: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(255,255,255,0.02)", borderRight: "1px solid rgba(255,255,255,0.08)" }
              : { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }
          }
          onClick={collapsedSide === "fields" ? () => setCollapsedSide("none") : undefined}
          title={collapsedSide === "fields" ? "Expand fields panel" : undefined}
        >
          {collapsedSide === "fields" ? (
            <IconChevron direction="right" />
          ) : (
            <>
              <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", padding: "0.3rem 0.6rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <button
                  type="button"
                  onClick={() => setCollapsedSide("fields")}
                  title="Collapse fields panel"
                  style={{
                    display: "grid", placeItems: "center", width: 24, height: 22, borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.1)", background: "none", color: "rgba(240,242,255,0.5)", cursor: "pointer",
                  }}
                >
                  <IconChevron direction="left" />
                </button>
              </div>
              <div className="raw-text-editor-fields" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "1.25rem", maxWidth: 520 }}>
          {(imgGroups.length > 0 || bgGroups.length > 0) && (
            <div style={{ marginBottom: "1.75rem" }}>
              <p style={sectionHeadingStyle}>Images</p>

              {imgGroups.map((group, gi) => (
                <div key={`img-${gi}`} style={{ marginBottom: "1rem" }}>
                  <p style={fieldLabelStyle}>
                    {group.label}{group.nodes.length > 1 ? ` (${group.nodes.length})` : ""}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {group.nodes.map((node) => {
                      const draft = imgDrafts[node.id] ?? { src: node.src, width: node.width, height: node.height };
                      const isActive = activeField?.kind === "img" && activeField.id === node.id;
                      return (
                        <div
                          key={node.id}
                          ref={registerFieldRef("img", node.id)}
                          className="raw-text-editor-img-row"
                          style={{
                            display: "flex", gap: "0.65rem", padding: "0.65rem",
                            borderRadius: 10,
                            border: isActive ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.08)",
                            boxShadow: isActive ? "0 0 0 3px rgba(139,92,246,0.2)" : "none",
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={draft.src}
                            alt={node.alt || "preview"}
                            style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, flexShrink: 0, background: "rgba(255,255,255,0.05)" }}
                          />
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                            <input
                              type="text"
                              value={draft.src}
                              onFocus={() => setActiveField({ kind: "img", id: node.id })}
                              onChange={(e) => handleImgSrcChange(node, e.target.value)}
                              placeholder="Image URL"
                              style={{
                                width: "100%", background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7,
                                color: "#f0f2ff", padding: "0.4rem 0.6rem", fontSize: "0.8rem",
                                outline: "none", fontFamily: "inherit",
                              }}
                            />
                            <div className="raw-text-editor-img-controls" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <input
                                type="number"
                                value={draft.width ?? ""}
                                onFocus={() => setActiveField({ kind: "img", id: node.id })}
                                onChange={(e) => handleImgSizeChange(node, "width", e.target.value)}
                                placeholder="Width"
                                style={{
                                  width: 70, background: "rgba(255,255,255,0.04)",
                                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7,
                                  color: "#f0f2ff", padding: "0.35rem 0.5rem", fontSize: "0.78rem",
                                  outline: "none", fontFamily: "inherit",
                                }}
                              />
                              <span style={{ color: "rgba(240,242,255,0.3)", fontSize: "0.75rem" }}>×</span>
                              <input
                                type="number"
                                value={draft.height ?? ""}
                                onFocus={() => setActiveField({ kind: "img", id: node.id })}
                                onChange={(e) => handleImgSizeChange(node, "height", e.target.value)}
                                placeholder="Height"
                                style={{
                                  width: 70, background: "rgba(255,255,255,0.04)",
                                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7,
                                  color: "#f0f2ff", padding: "0.35rem 0.5rem", fontSize: "0.78rem",
                                  outline: "none", fontFamily: "inherit",
                                }}
                              />
                              <span style={{ color: "rgba(240,242,255,0.35)", fontSize: "0.7rem" }}>px</span>
                              <button
                                type="button"
                                onClick={() => setLockAspect((prev) => ({ ...prev, [node.id]: !prev[node.id] }))}
                                title={lockAspect[node.id] ? "Aspect ratio locked" : "Aspect ratio unlocked"}
                                style={{
                                  marginLeft: "auto", width: 26, height: 26, borderRadius: 6,
                                  border: "1px solid rgba(255,255,255,0.1)",
                                  background: lockAspect[node.id] ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.04)",
                                  color: lockAspect[node.id] ? "#a78bfa" : "rgba(240,242,255,0.4)",
                                  cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0,
                                }}
                              >
                                <IconLock locked={!!lockAspect[node.id]} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {bgGroups.map((group, gi) => (
                <div key={`bg-${gi}`} style={{ marginBottom: "1rem" }}>
                  <p style={fieldLabelStyle}>
                    {group.label}{group.nodes.length > 1 ? ` (${group.nodes.length})` : ""}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {group.nodes.map((node) => {
                      const draft = bgDrafts[node.id] ?? { src: node.src, backgroundSize: node.backgroundSize };
                      const isActive = activeField?.kind === "background" && activeField.id === node.id;
                      return (
                        <div
                          key={node.id}
                          ref={registerFieldRef("background", node.id)}
                          style={{
                            display: "flex", gap: "0.65rem", padding: "0.65rem",
                            borderRadius: 10,
                            border: isActive ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.08)",
                            boxShadow: isActive ? "0 0 0 3px rgba(139,92,246,0.2)" : "none",
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div
                            style={{
                              width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                              backgroundImage: `url("${draft.src}")`, backgroundSize: "cover", backgroundPosition: "center",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                            <input
                              type="text"
                              value={draft.src}
                              onFocus={() => setActiveField({ kind: "background", id: node.id })}
                              onChange={(e) => handleBgChange(node, { src: e.target.value })}
                              placeholder="Background image URL"
                              style={{
                                width: "100%", background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7,
                                color: "#f0f2ff", padding: "0.4rem 0.6rem", fontSize: "0.8rem",
                                outline: "none", fontFamily: "inherit",
                              }}
                            />
                            {node.supportsResize && (
                              <BackgroundSizeSelect
                                value={draft.backgroundSize}
                                onFocus={() => setActiveField({ kind: "background", id: node.id })}
                                onChange={(value) => handleBgChange(node, { backgroundSize: value })}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sectionGroups.length > 0 && (
            <div>
              <p style={sectionHeadingStyle}>Text, by section</p>
              {sectionGroups.map((section, si) => (
                <div key={si} className="raw-text-editor-section" style={{ marginBottom: "1.75rem" }}>
                  <p style={sectionTitleStyle}>{section.label}</p>
                  {section.labelGroups.map((group, gi) => (
                    <div key={gi} style={{ marginBottom: "1.1rem" }}>
                      <p style={fieldLabelStyle}>
                        {group.label}{group.nodes.length > 1 ? ` (${group.nodes.length})` : ""}
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                        {group.nodes.map((node) => {
                          const long = node.text.length > 80;
                          const value = drafts[node.id] ?? node.text;
                          const hrefValue = node.href !== undefined ? hrefDrafts[node.id] ?? node.href : undefined;
                          const changed = value !== node.text || (node.href !== undefined && hrefValue !== node.href);
                          const isActive = activeField?.kind === "text" && activeField.id === node.id;
                          const fieldStyle: React.CSSProperties = {
                            width: "100%",
                            background: "rgba(255,255,255,0.04)",
                            border: isActive
                              ? "1px solid #8b5cf6"
                              : changed ? "1px solid rgba(139,92,246,0.4)" : "1px solid rgba(255,255,255,0.1)",
                            boxShadow: isActive ? "0 0 0 3px rgba(139,92,246,0.2)" : "none",
                            borderRadius: 8,
                            color: "#f0f2ff",
                            padding: "0.6rem 0.75rem",
                            fontSize: "0.85rem",
                            outline: "none",
                            fontFamily: "inherit",
                          };
                          const inputStyle: React.CSSProperties = { ...fieldStyle };
                          const textField = long ? (
                            <textarea
                              value={value}
                              rows={3}
                              onFocus={() => setActiveField({ kind: "text", id: node.id })}
                              onChange={(e) => handleDraftChange(node, e.target.value)}
                              style={inputStyle}
                            />
                          ) : (
                            <input
                              type="text"
                              value={value}
                              onFocus={() => setActiveField({ kind: "text", id: node.id })}
                              onChange={(e) => handleDraftChange(node, e.target.value)}
                              style={inputStyle}
                            />
                          );
                          if (node.href === undefined) {
                            return (
                              <div key={node.id} ref={registerFieldRef("text", node.id)}>
                                {textField}
                              </div>
                            );
                          }
                          return (
                            <div
                              key={node.id}
                              ref={registerFieldRef("text", node.id)}
                              className="raw-text-editor-link-field"
                              style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}
                            >
                              {textField}
                              <input
                                type="text"
                                value={hrefValue}
                                onFocus={() => setActiveField({ kind: "text", id: node.id })}
                                onChange={(e) => handleHrefChange(node, e.target.value)}
                                placeholder="Link URL (href)"
                                style={{
                                  ...fieldStyle,
                                  fontSize: "0.75rem",
                                  padding: "0.4rem 0.65rem",
                                  color: "rgba(240,242,255,0.7)",
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
              </div>
            </>
          )}
        </div>

        <div
          className={collapsedSide === "preview" ? "raw-text-editor-collapsed-strip" : "raw-text-editor-preview"}
          style={
            collapsedSide === "preview"
              ? { width: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(255,255,255,0.02)" }
              : { flex: 1, minWidth: 0, borderLeft: "1px solid rgba(255,255,255,0.08)", background: "#fff", position: "relative", display: "flex", flexDirection: "column" }
          }
          onClick={collapsedSide === "preview" ? () => setCollapsedSide("none") : undefined}
          title={collapsedSide === "preview" ? "Expand preview panel" : undefined}
        >
          {collapsedSide === "preview" ? (
            <IconChevron direction="left" />
          ) : (
            <>
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.4rem 0.75rem", fontSize: "0.72rem", lineHeight: 1.4,
            background: "rgba(17,19,31,0.85)", color: "rgba(240,242,255,0.6)",
          }}>
            <span style={{ flex: 1, minWidth: 0 }}>
            {scriptsActive ? (
              <>Full interactive preview active — JS-driven behavior (mobile menus, toggles, sliders) works, but
              field click-to-scroll, highlight, live-typing preview, and image drag-resize are paused while this
              is on.</>
            ) : (
              <>Static preview — scripts are disabled here for safety, so JS-driven behavior (mobile menus,
              toggles, sliders) won&apos;t run. Use <strong>Preview</strong> above for the fully interactive page,
              or request full script preview below.</>
            )}
            </span>
            <DeviceToggle value={device} onChange={setDevice} />
            <button
              type="button"
              onClick={() => setCollapsedSide("preview")}
              title="Collapse preview panel"
              style={{
                display: "grid", placeItems: "center", width: 24, height: 22, borderRadius: 6, flexShrink: 0,
                border: "1px solid rgba(255,255,255,0.15)", background: "none", color: "rgba(240,242,255,0.6)", cursor: "pointer",
              }}
            >
              <IconChevron direction="right" />
            </button>
          </div>
          <div
            className="raw-text-editor-device-frame"
            style={{
              flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center",
              background: device === "desktop" ? "#fff" : "#e2e2e6",
            }}
          >
            <div
              style={{
                width: DEVICE_WIDTHS[device],
                minWidth: device === "desktop" ? undefined : DEVICE_WIDTHS[device],
                height: "100%", flexShrink: 0, background: "#fff",
                boxShadow: device === "desktop" ? "none" : "0 0 0 1px rgba(0,0,0,0.08), 0 12px 30px rgba(0,0,0,0.15)",
              }}
            >
              {previewHtml !== null && (
                <iframe
                  // Changing key forces React to unmount + remount a fresh iframe element — a
                  // live iframe's sandbox attribute doesn't retroactively re-apply to content
                  // that already started running, so switching modes needs a real reload.
                  key={scriptsActive ? "scripted" : "sandboxed"}
                  ref={iframeRef}
                  title="Live preview"
                  srcDoc={previewHtml}
                  onLoad={handlePreviewLoad}
                  // Sandboxed mode: allow-same-origin (no allow-scripts) — DOM access for
                  // highlight/scroll/live-patch, nothing in the untrusted page can execute.
                  // Full script preview mode: allow-scripts WITHOUT allow-same-origin — the
                  // same safe, opaque-origin pattern the "Preview" modal in raw-file-editor.tsx
                  // already uses. Deliberately never both together: allow-same-origin on a
                  // srcDoc iframe resolves to THIS app's own origin, so combining it with
                  // allow-scripts would let untrusted uploaded JS reach the dashboard's session.
                  sandbox={scriptsActive ? "allow-scripts" : "allow-same-origin"}
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              )}
            </div>
          </div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .raw-text-editor-split {
            flex-direction: column;
          }
          .raw-text-editor-fields {
            max-width: none !important;
          }
          .raw-text-editor-preview {
            border-left: none !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            min-height: 320px;
          }
          .raw-text-editor-collapsed-strip {
            width: 100% !important;
            height: 36px !important;
            flex-direction: row !important;
          }
          .raw-text-editor-device-frame {
            min-height: 260px;
          }
        }
        @media (max-width: 640px) {
          .raw-text-editor-header {
            flex-direction: column;
            align-items: stretch;
            gap: 0.6rem;
          }
          .raw-text-editor-header > div {
            justify-content: flex-end;
          }
          .raw-text-editor-fields {
            padding: 0.85rem !important;
          }
          .raw-text-editor-section {
            margin-bottom: 1.35rem !important;
          }
          .raw-text-editor-img-row {
            flex-wrap: wrap;
          }
          .raw-text-editor-img-controls {
            flex-wrap: wrap;
            row-gap: 0.35rem;
          }
        }
        @media (max-width: 420px) {
          .raw-text-editor-header p {
            font-size: 0.75rem !important;
          }
        }
      `}</style>
    </div>
  );
}
