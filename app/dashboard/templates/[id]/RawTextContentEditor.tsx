"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtractedTextNode } from "@/lib/htmlTextExtraction";
import type { ExtractedImageNode, ExtractedImgNode, ExtractedBackgroundNode } from "@/lib/htmlImageExtraction";

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

const ATTR_FOR_KIND: Record<"text" | "img" | "background", string> = {
  text: "data-ptid",
  img: "data-pimg",
  background: "data-pbg",
};

/** Groups consecutive nodes under the same label so the list reads as sections
 * ("Menu item", "Heading", "Button"...) rather than one flat unlabeled list — purely
 * derived from whatever the extractor found, no hardcoded structure. */
function groupByLabel<T extends { label: string }>(nodes: T[]): { label: string; nodes: T[] }[] {
  const groups: { label: string; nodes: T[] }[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last.label === node.label) {
      last.nodes.push(node);
    } else {
      groups.push({ label: node.label, nodes: [node] });
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
  const [imgDrafts, setImgDrafts] = useState<Record<number, ImgDraft>>({});
  const [bgDrafts, setBgDrafts] = useState<Record<number, BgDraft>>({});
  const [lockAspect, setLockAspect] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
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
    if (!previewReady) return;
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
  }, [activeField, previewReady]);

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
    if (!doc || !previewReady) return;
    const target = doc.querySelector(`[data-ptid~="${node.id}"]`);
    if (target && target.getAttribute("data-ptid") === String(node.id)) {
      target.textContent = value;
    }
  }

  function handleImgSrcChange(node: ExtractedImgNode, value: string) {
    setImgDrafts((prev) => ({ ...prev, [node.id]: { ...prev[node.id], src: value } }));
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !previewReady) return;
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
      if (doc && previewReady) {
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
    if (!doc || !previewReady) return;
    findPreviewElements(doc, "background", node.id).forEach((el) => {
      const style = (el as HTMLElement).style;
      if (patch.src !== undefined) style.backgroundImage = `url("${patch.src}")`;
      if (patch.backgroundSize !== undefined) {
        if (patch.backgroundSize === null) style.removeProperty("background-size");
        else style.backgroundSize = patch.backgroundSize;
      }
    });
  }

  const textDirty = nodes?.some((n) => drafts[n.id] !== n.text) ?? false;
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
        .filter((n) => drafts[n.id] !== n.text)
        .map((n) => ({ id: n.id, text: drafts[n.id] }));
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

      setNodes((prev) => prev?.map((n) => ({ ...n, text: drafts[n.id] ?? n.text })) ?? null);
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

  const groups = groupByLabel(nodes ?? []);
  const imgGroups = groupByLabel(imgNodes);
  const bgGroups = groupByLabel(bgNodes);

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    color: "rgba(240,242,255,0.35)", marginBottom: "0.6rem",
  };
  const fieldLabelStyle: React.CSSProperties = { ...sectionHeadingStyle, marginBottom: "0.3rem" };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
          Every piece of visible text and every image on this page — edit and save without touching
          markup. Click a field to see exactly where it is on the page.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {saveError && <span style={{ color: "#f87171", fontSize: "0.78rem" }}>⚠️ {saveError}</span>}
          {savedFlash && <span style={{ color: "#34d399", fontSize: "0.78rem" }}>✓ Saved</span>}
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

      <div className="raw-text-editor-split" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "1.25rem", maxWidth: 520 }}>
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
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
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
                                {lockAspect[node.id] ? "🔒" : "🔓"}
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
                              <select
                                value={draft.backgroundSize ?? ""}
                                onFocus={() => setActiveField({ kind: "background", id: node.id })}
                                onChange={(e) => handleBgChange(node, { backgroundSize: e.target.value || null })}
                                style={{
                                  width: "100%", background: "rgba(255,255,255,0.04)",
                                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7,
                                  color: "#f0f2ff", padding: "0.35rem 0.5rem", fontSize: "0.78rem",
                                  outline: "none", fontFamily: "inherit",
                                }}
                              >
                                <option value="">Default</option>
                                <option value="cover">Cover (fill, cropped)</option>
                                <option value="contain">Contain (fit, no crop)</option>
                                <option value="auto">Auto (original size)</option>
                                <option value="100% 100%">Stretch to fit</option>
                              </select>
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

          {groups.length > 0 && (
            <div>
              <p style={sectionHeadingStyle}>Text</p>
              {groups.map((group, gi) => (
                <div key={gi} style={{ marginBottom: "1.5rem" }}>
                  <p style={fieldLabelStyle}>
                    {group.label}{group.nodes.length > 1 ? ` (${group.nodes.length})` : ""}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {group.nodes.map((node) => {
                      const long = node.text.length > 80;
                      const value = drafts[node.id] ?? node.text;
                      const changed = value !== node.text;
                      const isActive = activeField?.kind === "text" && activeField.id === node.id;
                      const inputStyle: React.CSSProperties = {
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
                      return long ? (
                        <textarea
                          key={node.id}
                          value={value}
                          rows={3}
                          onFocus={() => setActiveField({ kind: "text", id: node.id })}
                          onChange={(e) => handleDraftChange(node, e.target.value)}
                          style={inputStyle}
                        />
                      ) : (
                        <input
                          key={node.id}
                          type="text"
                          value={value}
                          onFocus={() => setActiveField({ kind: "text", id: node.id })}
                          onChange={(e) => handleDraftChange(node, e.target.value)}
                          style={inputStyle}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="raw-text-editor-preview" style={{
          flex: 1, minWidth: 0, borderLeft: "1px solid rgba(255,255,255,0.08)",
          background: "#fff", position: "relative",
        }}>
          {previewHtml !== null && (
            <iframe
              ref={iframeRef}
              title="Live preview"
              srcDoc={previewHtml}
              onLoad={handlePreviewLoad}
              // allow-same-origin (no allow-scripts) — read/write DOM access is needed to
              // highlight/scroll/live-patch text and images, but nothing in this untrusted
              // page can execute.
              sandbox="allow-same-origin"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .raw-text-editor-split {
            flex-direction: column;
          }
          .raw-text-editor-preview {
            border-left: none !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            min-height: 260px;
          }
        }
      `}</style>
    </div>
  );
}
