"use client";

import { useState } from "react";
import { FunnelRichTextEditor } from "./FunnelRichTextEditor";

type PageKind = "WELCOME" | "VIDEO" | "DOCUMENT" | "IMAGE";
type BuilderLevel = "BEGINNER" | "INTERMEDIATE" | "PROFESSIONAL";

type UnlockCondition =
  | { type: "PREREQUISITE_PAGES"; pageIds: string[] }
  | { type: "TIME_DRIP_RELATIVE"; daysAfterEnrollment: number }
  | { type: "TIME_DRIP_FIXED_DATE"; unlockAt: string }
  | { type: "MANUAL_APPROVAL" };

type UnlockRules = { mode: "ALL"; conditions: UnlockCondition[] };

type ContentMode = "SIMPLE" | "RAW_HTML" | "ADVANCED";

type FunnelPage = {
  id: string;
  order: number;
  kind: PageKind;
  title: string;
  contentMode?: ContentMode;
  bodyHtml?: string;
  designTemplateId?: string;
  youtubeVideoId?: string;
  assetUrl?: string;
  assetFileName?: string;
  unlockRules?: UnlockRules;
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.7rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: "0.9rem" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </label>
  );
}

const KIND_META: Record<PageKind, { label: string; icon: string }> = {
  WELCOME: { label: "Welcome", icon: "👋" },
  VIDEO: { label: "YouTube video", icon: "▶" },
  DOCUMENT: { label: "Document", icon: "📄" },
  IMAGE: { label: "Image", icon: "🖼" },
};

function extractYoutubeId(url: string): string {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return match?.[1] ?? url.trim();
}

function unlockSummary(page: FunnelPage, previousPage: FunnelPage | undefined): string {
  const conditions = page.unlockRules?.conditions ?? [];
  if (conditions.length === 0) return "Always unlocked";
  if (conditions.length === 1) {
    const c = conditions[0];
    if (c.type === "PREREQUISITE_PAGES") {
      if (previousPage && c.pageIds.length === 1 && c.pageIds[0] === previousPage.id) return "Unlocks when the previous page is finished";
      return `Unlocks after ${c.pageIds.length} page${c.pageIds.length === 1 ? "" : "s"} are finished`;
    }
    if (c.type === "TIME_DRIP_RELATIVE") return `Unlocks ${c.daysAfterEnrollment} day${c.daysAfterEnrollment === 1 ? "" : "s"} after signup`;
    if (c.type === "TIME_DRIP_FIXED_DATE") return `Unlocks on ${new Date(c.unlockAt).toLocaleDateString()}`;
    if (c.type === "MANUAL_APPROVAL") return "Needs your approval";
  }
  return `${conditions.length} conditions`;
}

async function api(input: string, init?: RequestInit) {
  const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

export function PagesBuilderClient({
  templateId, initialPages, builderLevel,
}: { templateId: string; initialPages: FunnelPage[]; builderLevel: BuilderLevel }) {
  const [pages, setPages] = useState<FunnelPage[]>(initialPages);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/lms/funnels/${templateId}`;

  function updateLocal(id: string, patch: Partial<FunnelPage>) {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function savePage(id: string, patch: Record<string, unknown>) {
    updateLocal(id, patch as Partial<FunnelPage>);
    await api(`${base}/pages/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => {});
  }

  async function addPage() {
    setBusy(true);
    try {
      const { page } = await api(`${base}/pages`, { method: "POST", body: JSON.stringify({}) });
      setPages((prev) => [...prev, page]);
      setExpandedId(page.id);
    } catch {
      // no-op — a failed add just leaves the list unchanged
    } finally {
      setBusy(false);
    }
  }

  async function deletePage(id: string) {
    if (!confirm("Delete this page? Visitors' progress on it will be lost.")) return;
    setPages((prev) => prev.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i })));
    await api(`${base}/pages/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function reorder(nextPages: FunnelPage[]) {
    setPages(nextPages);
    await api(`${base}/pages/reorder`, { method: "POST", body: JSON.stringify({ orderedPageIds: nextPages.map((p) => p.id) }) }).catch(() => {});
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const fromIndex = pages.findIndex((p) => p.id === draggedId);
    const toIndex = pages.findIndex((p) => p.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...pages];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    reorder(next.map((p, i) => ({ ...p, order: i })));
    setDraggedId(null);
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {pages.map((page, index) => (
          <PageRow
            key={page.id}
            page={page}
            previousPage={pages[index - 1]}
            index={index}
            templateId={templateId}
            allPages={pages}
            expanded={expandedId === page.id}
            builderLevel={builderLevel}
            onToggle={() => setExpandedId((cur) => (cur === page.id ? null : page.id))}
            onPatch={(patch) => savePage(page.id, patch)}
            onDelete={() => deletePage(page.id)}
            onDragStart={() => setDraggedId(page.id)}
            onDrop={() => handleDrop(page.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addPage}
        disabled={busy}
        style={{
          marginTop: "0.85rem", width: "100%", padding: "0.75rem", borderRadius: 12,
          border: "1px dashed rgba(255,255,255,0.15)", background: "transparent", color: "rgba(240,242,255,0.6)",
          fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
        }}
      >
        + Add page
      </button>
    </div>
  );
}

function PageRow({
  page, previousPage, index, templateId, allPages, expanded, builderLevel, onToggle, onPatch, onDelete, onDragStart, onDrop,
}: {
  page: FunnelPage;
  previousPage: FunnelPage | undefined;
  index: number;
  templateId: string;
  allPages: FunnelPage[];
  expanded: boolean;
  builderLevel: BuilderLevel;
  onToggle: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const meta = KIND_META[page.kind];
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden" }}
    >
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem", cursor: "pointer" }}
      >
        <span style={{ cursor: "grab", color: "rgba(240,242,255,0.3)", fontSize: "0.9rem" }}>⠿</span>
        <span style={{
          width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0,
          background: "rgba(var(--brand-rgb),0.14)", fontSize: "0.85rem",
        }}>
          {meta.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f0f2ff" }}>{index + 1}. {page.title}</div>
          <div style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.45)" }}>{unlockSummary(page, previousPage)}</div>
        </div>
        <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)" }}>{meta.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(240,242,255,0.4)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {expanded && (
        <div style={{ padding: "0 1.1rem 1.1rem" }}>
          <FieldLabel label="Page title">
            <input style={inputStyle} value={page.title} onChange={(e) => onPatch({ title: e.target.value })} />
          </FieldLabel>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem" }}>
            {(["WELCOME", "VIDEO", "DOCUMENT", "IMAGE"] as PageKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onPatch({ kind })}
                style={{
                  flex: 1, padding: "0.5rem", borderRadius: 9, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
                  background: page.kind === kind ? "rgba(var(--brand-rgb),0.18)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${page.kind === kind ? "var(--brand, var(--brand))" : "rgba(255,255,255,0.09)"}`,
                  color: page.kind === kind ? "#c4b5fd" : "rgba(240,242,255,0.6)",
                }}
              >
                {KIND_META[kind].label}
              </button>
            ))}
          </div>

          <PageContentEditor page={page} templateId={templateId} onPatch={onPatch} />

          <UnlockRuleControl page={page} previousPage={previousPage} allPages={allPages} builderLevel={builderLevel} onPatch={onPatch} />

          <button
            type="button"
            onClick={onDelete}
            style={{ marginTop: "1rem", fontSize: "0.78rem", color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Delete page
          </button>
        </div>
      )}
    </div>
  );
}

const CONTENT_MODE_LABELS: Record<ContentMode, string> = { SIMPLE: "Rich text", RAW_HTML: "Raw HTML", ADVANCED: "Full page builder" };

/**
 * Three ways to author a Welcome page's content, all writing into the same underlying page
 * (see contentEntities.ts's LmsPage.contentMode comment): a WYSIWYG rich-text editor for
 * most admins, a plain-HTML textarea for anyone who'd rather hand-write it (both render
 * sanitized on the real page — see .../pages/[pageId]/route.ts), or the full drag-and-drop
 * PlexoBuilder for admins who want complete design freedom, via a real (hidden) Template
 * edited at /dashboard/templates/[id] and embedded by iframe in the learner portal.
 */
function WelcomeContentEditor({ page, templateId, onPatch }: { page: FunnelPage; templateId: string; onPatch: (patch: Record<string, unknown>) => void }) {
  const [creatingDesign, setCreatingDesign] = useState(false);
  const mode = page.contentMode ?? "SIMPLE";

  async function switchMode(next: ContentMode) {
    if (next === "ADVANCED" && !page.designTemplateId) {
      setCreatingDesign(true);
      try {
        const { designTemplateId } = await api(`/api/v1/lms/funnels/${templateId}/pages/${page.id}/design`, { method: "POST" });
        onPatch({ contentMode: "ADVANCED", designTemplateId });
      } catch {
        // no-op — leave the mode unchanged on failure
      } finally {
        setCreatingDesign(false);
      }
      return;
    }
    onPatch({ contentMode: next });
  }

  async function uploadImage(file: File): Promise<string | null> {
    try {
      const presigned = await api(`/api/v1/lms/funnels/${templateId}/upload`, {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const formData = new FormData();
      Object.entries(presigned.fields as Record<string, string>).forEach(([k, v]) => formData.append(k, v));
      formData.append("file", file);
      await fetch(presigned.url, { method: "POST", body: formData });
      return presigned.publicUrl as string;
    } catch {
      return null;
    }
  }

  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {(Object.keys(CONTENT_MODE_LABELS) as ContentMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            disabled={creatingDesign}
            style={{
              flex: 1, padding: "0.45rem", borderRadius: 8, fontSize: "0.76rem", fontWeight: 600, cursor: creatingDesign ? "wait" : "pointer",
              background: mode === m ? "rgba(var(--brand-rgb),0.18)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${mode === m ? "var(--brand, var(--brand))" : "rgba(255,255,255,0.09)"}`,
              color: mode === m ? "#c4b5fd" : "rgba(240,242,255,0.6)",
            }}
          >
            {m === "ADVANCED" && creatingDesign ? "Setting up…" : CONTENT_MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === "SIMPLE" && (
        <FunnelRichTextEditor initialContent={page.bodyHtml ?? ""} onChange={(html) => onPatch({ bodyHtml: html })} onUploadFile={uploadImage} />
      )}

      {mode === "RAW_HTML" && (
        <FieldLabel label="Raw HTML">
          <textarea
            rows={8}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
            value={page.bodyHtml ?? ""}
            onChange={(e) => onPatch({ bodyHtml: e.target.value })}
            placeholder="<p>Welcome! We're glad you're here.</p>"
          />
          <div style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "0.35rem" }}>
            Rendered exactly as written, minus anything unsafe — sanitized before it reaches a real visitor.
          </div>
        </FieldLabel>
      )}

      {mode === "ADVANCED" && page.designTemplateId && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: "0.83rem", color: "rgba(240,242,255,0.6)", marginBottom: "0.7rem" }}>
            This page's design is built with the full drag-and-drop page builder, separately from this panel.
          </div>
          <a
            href={`/dashboard/templates/${page.designTemplateId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.9rem", borderRadius: 8, background: "var(--brand, var(--brand))", color: "#fff", textDecoration: "none", fontSize: "0.8rem", fontWeight: 700 }}
          >
            Open design editor
          </a>
        </div>
      )}
    </div>
  );
}

function PageContentEditor({ page, templateId, onPatch }: { page: FunnelPage; templateId: string; onPatch: (patch: Record<string, unknown>) => void }) {
  const [uploading, setUploading] = useState(false);
  const [showVideoUploadComingSoon, setShowVideoUploadComingSoon] = useState(false);
  const [notified, setNotified] = useState(false);

  if (page.kind === "WELCOME") {
    return <WelcomeContentEditor page={page} templateId={templateId} onPatch={onPatch} />;
  }

  if (page.kind === "VIDEO") {
    return (
      <div style={{ marginBottom: "0.9rem" }}>
        <FieldLabel label="YouTube URL">
          <input
            style={inputStyle}
            value={page.youtubeVideoId ?? ""}
            onChange={(e) => onPatch({ youtubeVideoId: extractYoutubeId(e.target.value) })}
            placeholder="https://youtube.com/watch?v=..."
          />
        </FieldLabel>
        {page.youtubeVideoId && (
          <div style={{ aspectRatio: "16/9", borderRadius: 10, overflow: "hidden", marginBottom: "0.9rem" }}>
            <iframe
              src={`https://www.youtube.com/embed/${page.youtubeVideoId}`}
              style={{ width: "100%", height: "100%", border: "none" }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {!showVideoUploadComingSoon ? (
          <button
            type="button"
            onClick={() => setShowVideoUploadComingSoon(true)}
            style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Or upload a video file instead
          </button>
        ) : (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.9rem 1rem" }}>
            <div style={{ fontSize: "0.83rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.25rem" }}>Video uploads are coming soon</div>
            <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginBottom: "0.7rem" }}>
              For now, use a YouTube link above. We're designing real video hosting carefully — let us know you want it.
            </div>
            {notified ? (
              <div style={{ fontSize: "0.78rem", color: "#34d399" }}>Thanks — we'll let you know when it's ready.</div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  setNotified(true);
                  await api("/api/v1/lms/video-upload-interest", { method: "POST", body: JSON.stringify({ templateId }) }).catch(() => {});
                }}
                style={{
                  padding: "0.45rem 0.8rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700,
                  background: "var(--brand, var(--brand))", color: "#fff", border: "none", cursor: "pointer",
                }}
              >
                Notify me when available
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // DOCUMENT / IMAGE
  const accept = page.kind === "IMAGE" ? "image/*" : "application/pdf,.doc,.docx,.ppt,.pptx";
  return (
    <FieldLabel label={page.kind === "IMAGE" ? "Image" : "Document"}>
      {page.assetUrl && (
        <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.6)", marginBottom: "0.5rem" }}>
          Uploaded: {page.assetFileName ?? "file"}
        </div>
      )}
      <input
        type="file"
        accept={accept}
        disabled={uploading}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setUploading(true);
          try {
            const presigned = await api(`/api/v1/lms/funnels/${templateId}/upload`, {
              method: "POST",
              body: JSON.stringify({ filename: file.name, contentType: file.type }),
            });
            const formData = new FormData();
            Object.entries(presigned.fields as Record<string, string>).forEach(([k, v]) => formData.append(k, v));
            formData.append("file", file);
            await fetch(presigned.url, { method: "POST", body: formData });
            onPatch({ assetUrl: presigned.publicUrl, assetFileName: file.name, assetMimeType: file.type, assetSizeBytes: file.size });
          } catch {
            // no-op — leave the field as-is on failure
          } finally {
            setUploading(false);
          }
        }}
        style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)" }}
      />
      {uploading && <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", marginTop: "0.4rem" }}>Uploading…</div>}
    </FieldLabel>
  );
}

const CONDITION_LABELS: Record<UnlockCondition["type"], string> = {
  PREREQUISITE_PAGES: "These pages are completed",
  TIME_DRIP_RELATIVE: "Days after signup",
  TIME_DRIP_FIXED_DATE: "On a fixed date",
  MANUAL_APPROVAL: "Needs my approval",
};

function UnlockRuleControl({
  page, previousPage, allPages, builderLevel, onPatch,
}: { page: FunnelPage; previousPage: FunnelPage | undefined; allPages: FunnelPage[]; builderLevel: BuilderLevel; onPatch: (patch: Record<string, unknown>) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(builderLevel !== "BEGINNER");
  const [editing, setEditing] = useState(false);
  const conditions = page.unlockRules?.conditions ?? [];

  function setConditions(next: UnlockCondition[]) {
    onPatch({ unlockRules: { mode: "ALL", conditions: next } });
  }

  function resetToDefault() {
    setConditions(previousPage ? [{ type: "PREREQUISITE_PAGES", pageIds: [previousPage.id] }] : []);
    setEditing(false);
  }

  if (!showAdvanced) {
    return (
      <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)" }}>
        {unlockSummary(page, previousPage)} —{" "}
        <button type="button" onClick={() => setShowAdvanced(true)} style={{ background: "none", border: "none", color: "var(--brand, #a78bfa)", cursor: "pointer", padding: 0, fontSize: "0.8rem" }}>
          Show advanced options
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.6)" }}>
        {unlockSummary(page, previousPage)} —{" "}
        <button type="button" onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--brand, #a78bfa)", cursor: "pointer", padding: 0, fontSize: "0.8rem" }}>
          Change
        </button>
      </div>
    );
  }

  const otherPages = allPages.filter((p) => p.id !== page.id);

  function updateCondition(i: number, next: UnlockCondition) {
    const conditionsNext = [...conditions];
    conditionsNext[i] = next;
    setConditions(conditionsNext);
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.85rem 0.9rem", marginBottom: "0.9rem" }}>
      {conditions.map((condition, i) => (
        <div key={i} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 9, padding: "0.7rem 0.8rem", marginBottom: "0.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "0.76rem", color: "rgba(240,242,255,0.4)", flexShrink: 0, whiteSpace: "nowrap" }}>Unlocks when</span>
            <select
              value={condition.type}
              onChange={(e) => {
                const type = e.target.value as UnlockCondition["type"];
                updateCondition(
                  i,
                  type === "PREREQUISITE_PAGES" ? { type, pageIds: previousPage ? [previousPage.id] : [] }
                  : type === "TIME_DRIP_RELATIVE" ? { type, daysAfterEnrollment: 1 }
                  : type === "TIME_DRIP_FIXED_DATE" ? { type, unlockAt: new Date().toISOString().slice(0, 10) }
                  : { type },
                );
              }}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            >
              {(Object.keys(CONDITION_LABELS) as UnlockCondition["type"][]).map((t) => (
                <option key={t} value={t}>{CONDITION_LABELS[t]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}
              title="Remove condition"
              style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", fontSize: "1rem", flexShrink: 0, padding: "0 0.2rem", lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          {condition.type === "PREREQUISITE_PAGES" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.65rem", paddingLeft: "0.1rem" }}>
              {otherPages.length === 0 ? (
                <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: 0 }}>No other pages yet — add one first.</p>
              ) : (
                otherPages.map((p) => {
                  const checked = condition.pageIds.includes(p.id);
                  return (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontSize: "0.82rem", color: "#e2e4f5", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const pageIds = e.target.checked ? [...condition.pageIds, p.id] : condition.pageIds.filter((id) => id !== p.id);
                          updateCondition(i, { type: "PREREQUISITE_PAGES", pageIds });
                        }}
                      />
                      {p.title}
                    </label>
                  );
                })
              )}
            </div>
          )}
          {condition.type === "TIME_DRIP_RELATIVE" && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.65rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.6)" }}>
              <span>After</span>
              <input
                type="number"
                min={0}
                value={condition.daysAfterEnrollment}
                onChange={(e) => updateCondition(i, { type: "TIME_DRIP_RELATIVE", daysAfterEnrollment: Number(e.target.value) })}
                style={{ ...inputStyle, width: 70, textAlign: "center" }}
              />
              <span>day{condition.daysAfterEnrollment === 1 ? "" : "s"} after signup</span>
            </div>
          )}
          {condition.type === "TIME_DRIP_FIXED_DATE" && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.65rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.6)" }}>
              <span>On</span>
              <input
                type="date"
                value={condition.unlockAt.slice(0, 10)}
                onChange={(e) => updateCondition(i, { type: "TIME_DRIP_FIXED_DATE", unlockAt: e.target.value })}
                style={{ ...inputStyle, width: 170 }}
              />
            </div>
          )}
          {condition.type === "MANUAL_APPROVAL" && (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", margin: "0.5rem 0 0" }}>
              You'll approve each learner for this page from Enrollments.
            </p>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.6rem" }}>
        <button
          type="button"
          onClick={() => setConditions([...conditions, { type: "PREREQUISITE_PAGES", pageIds: previousPage ? [previousPage.id] : [] }])}
          style={{ fontSize: "0.78rem", color: "var(--brand, #a78bfa)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          + Add condition
        </button>
        <button type="button" onClick={resetToDefault} style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Reset to default
        </button>
        <button type="button" onClick={() => setEditing(false)} style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: "auto" }}>
          Done
        </button>
      </div>
    </div>
  );
}
