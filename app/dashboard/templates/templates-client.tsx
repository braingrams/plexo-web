"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "../_components/PageHeader";
import { useNewSite } from "../_components/NewSiteModal";
import { TemplateCard, IconMail, type TemplateKind, type TemplateSummary } from "./TemplateCard";

type Props = {
  initialTemplates: TemplateSummary[];
  // Server-rendered: new landing pages are offered ready-made page designs.
  pageDesignsForNew?: boolean;
};

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}



type FilterKind = "ALL" | TemplateKind | "FUNNEL";

export function TemplatesClient({ initialTemplates }: Props) {
  const { openNewSite } = useNewSite();
  const [templates, setTemplates] = useState<TemplateSummary[]>(initialTemplates);
  const [filter, setFilter] = useState<FilterKind>("ALL");
  const [search, setSearch] = useState("");

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Duplicate state
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  async function handleDuplicate(template: TemplateSummary) {
    setDuplicatingId(template.id);
    setDuplicateError(null);
    try {
      const res = await fetch(`/api/templates/${template.id}/duplicate-site`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to duplicate site");
      setTemplates((prev) => [
        { ...template, id: data.template.id, name: data.template.name, pageCount: data.template.pageCount ?? 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ...prev,
      ]);
    } catch (err: any) {
      setDuplicateError(err.message || "Failed to duplicate site");
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/templates/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete template");
      setTemplates((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete template");
    } finally {
      setIsDeleting(false);
    }
  }

  const filtered = useMemo(() => {
    let list = templates;
    if (filter === "FUNNEL") list = list.filter((t) => t.isLmsFunnel);
    else if (filter !== "ALL") list = list.filter((t) => t.kind === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return list;
  }, [templates, filter, search]);


  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Your Templates"
        action={
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              id="create-template-btn"
              type="button"
              onClick={openNewSite}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.65rem 1.2rem",
                borderRadius: 10, fontWeight: 700, fontSize: "0.875rem",
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: "#fff", border: "none", cursor: "pointer",
                boxShadow: "0 4px 20px var(--brand-glow)",
                transition: "opacity 0.15s, box-shadow 0.15s",
                fontFamily: "inherit",
              }}
            >
              <IconPlus />
              New site
            </button>
          </div>
        }
      />

      {/* Toolbar: filter tabs + search */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem",
      }}>
        {/* Filter tabs */}
        <div style={{
          display: "flex", gap: "0.25rem",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10, padding: "0.25rem",
        }}>
          {(["ALL", "EMAIL", "LANDING_PAGE", "FUNNEL"] as const).map((tab) => {
            const label = tab === "ALL" ? "All" : tab === "EMAIL" ? "Email" : tab === "LANDING_PAGE" ? "Landing Pages" : "Funnels";
            const active = filter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                style={{
                  padding: "0.4rem 0.9rem",
                  borderRadius: 8, border: "none", cursor: "pointer",
                  fontSize: "0.8rem", fontWeight: active ? 700 : 500,
                  background: active ? "rgba(var(--brand-rgb),0.15)" : "transparent",
                  color: active ? "var(--brand)" : "rgba(240,242,255,0.5)",
                  transition: "background 0.15s, color 0.15s",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {/* Search */}
        <div style={{ position: "relative", maxWidth: 260, flex: 1 }}>
          <span style={{
            position: "absolute", left: "0.75rem", top: "50%",
            transform: "translateY(-50%)", color: "rgba(240,242,255,0.3)",
            display: "flex",
          }}>
            <IconSearch />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 9,
              color: "#f0f2ff",
              padding: "0.5rem 0.75rem 0.5rem 2.25rem",
              fontSize: "0.875rem",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {duplicateError && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10,
          padding: "0.7rem 1rem", marginBottom: "1rem", fontSize: "0.83rem", color: "#f87171",
        }}>
          {duplicateError}
          <button
            type="button"
            onClick={() => setDuplicateError(null)}
            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}
          >
            <IconX />
          </button>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="templates-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: "1.25rem",
        }}>
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onDelete={setDeleteTarget}
              onDuplicate={handleDuplicate}
              duplicating={duplicatingId === template.id}
            />
          ))}
        </div>
      ) : (
        <div style={{
          padding: "4rem 2rem",
          textAlign: "center",
          borderRadius: 16,
          border: "1px dashed rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.015)",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "rgba(var(--brand-rgb),0.08)",
            border: "1px solid rgba(var(--brand-rgb),0.15)",
            display: "grid", placeItems: "center",
            margin: "0 auto 1rem",
            color: "var(--brand)",
          }}>
            <IconMail />
          </div>
          <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", color: "#f0f2ff", marginBottom: "0.5rem" }}>
            {search || filter !== "ALL" ? "No templates match your search." : "No templates yet."}
          </h3>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.4)", marginBottom: "1.5rem" }}>
            {search || filter !== "ALL" ? "Try a different search or filter." : "Create your first template to get started."}
          </p>
          {!search && filter === "ALL" && (
            <button
              type="button"
              onClick={openNewSite}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.65rem 1.25rem",
                borderRadius: 10, border: "none", cursor: "pointer",
                fontSize: "0.875rem", fontWeight: 700,
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: "#fff",
                boxShadow: "0 4px 20px var(--brand-glow)",
                fontFamily: "inherit",
              }}
            >
              <IconPlus />
              Create First Template
            </button>
          )}
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ────────────────────────── */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "grid", placeItems: "center",
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            padding: "1rem",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) { setDeleteTarget(null); } }}
        >
          <div style={{
            width: "min(100%,440px)",
            background: "#0d0f1a",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 20,
            padding: "1.75rem",
            boxShadow: "0 30px 100px rgba(0,0,0,0.8)",
          }}>
            <div style={{ marginBottom: "1.25rem" }}>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#ef4444", marginBottom: "0.3rem" }}>
                Confirm Deletion
              </p>
              <h2 id="delete-modal-title" style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.25rem", fontWeight: 800, color: "#f0f2ff" }}>
                Delete &quot;{deleteTarget.name}&quot;?
              </h2>
              <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.6)", marginTop: "0.5rem", lineHeight: 1.5 }}>
                This permanently deletes the site and everything in it: its pages, files and domains, plus its blog posts, shop products, settings and form submissions. Past orders stay in your records. This can&rsquo;t be undone.
              </p>
            </div>

            {deleteError && (
              <p style={{ fontSize: "0.8rem", color: "#ef4444", marginBottom: "1rem" }}>
                {deleteError}
              </p>
            )}

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                style={{
                  padding: "0.6rem 1.2rem",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#f0f2ff",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                style={{
                  padding: "0.6rem 1.2rem",
                  borderRadius: 10,
                  border: "none",
                  background: "#dc2626",
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  opacity: isDeleting ? 0.7 : 1,
                  fontFamily: "inherit",
                }}
              >
                {isDeleting ? "Deleting…" : "Delete Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @media (max-width: 480px) {
          .templates-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
