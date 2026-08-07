"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../_components/PageHeader";
import { PageContainer } from "../_components/PageContainer";
import { NewFromMarketplace } from "./NewFromMarketplace";
import { TemplateCard, IconMail, IconLayout, type TemplateKind, type TemplateSummary } from "./TemplateCard";

type CreatePayload = {
  template: TemplateSummary;
};

type Props = {
  initialTemplates: TemplateSummary[];
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

function IconStore() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

type FilterKind = "ALL" | TemplateKind;
type ModalStep = "choose" | "blank" | "gallery";

export function TemplatesClient({ initialTemplates }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateSummary[]>(initialTemplates);
  const [filter, setFilter] = useState<FilterKind>("ALL");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>("choose");
  const [templateName, setTemplateName] = useState("");
  const [templateKind, setTemplateKind] = useState<TemplateKind>("EMAIL");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    if (filter !== "ALL") list = list.filter((t) => t.kind === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return list;
  }, [templates, filter, search]);

  async function handleCreate(): Promise<void> {
    if (!templateName.trim()) {
      setError("Template name is required.");
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName, kind: templateKind }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to create template.");
      }
      const payload = (await response.json()) as CreatePayload;
      setTemplates((current) => [payload.template, ...current]);
      setModalOpen(false);
      setTemplateName("");
      setTemplateKind("EMAIL");
      router.push(`/dashboard/templates/${payload.template.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create template.");
    } finally {
      setIsCreating(false);
    }
  }

  function openModal() {
    setModalOpen(true);
    setModalStep("choose");
    setError(null);
    setTemplateName("");
    setTemplateKind("EMAIL");
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Workspace"
        title="Your Templates"
        action={
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              id="create-template-btn"
              type="button"
              onClick={openModal}
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
              New Template
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
          {(["ALL", "EMAIL", "LANDING_PAGE"] as const).map((tab) => {
            const label = tab === "ALL" ? "All" : tab === "EMAIL" ? "Email" : "Landing Pages";
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
                  background: active ? "rgba(139,92,246,0.15)" : "transparent",
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

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="templates-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: "1.25rem",
        }}>
          {filtered.map((template) => (
            <TemplateCard key={template.id} template={template} onDelete={setDeleteTarget} />
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
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.15)",
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
              onClick={openModal}
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

      {/* ── CREATE MODAL ────────────────────────── */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-modal-title"
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "grid", placeItems: "center",
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            padding: "1rem",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) { setModalOpen(false); } }}
        >
          <div style={{
            width: modalStep === "gallery" ? "min(100%,560px)" : "min(100%,480px)",
            background: "#0d0f1a",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 20,
            padding: "1.75rem",
            boxShadow: "0 30px 100px rgba(0,0,0,0.7), 0 0 0 1px var(--brand-subtle)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
              <div>
                <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.3rem" }}>
                  New Template
                </p>
                <h2 id="create-modal-title" style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.35rem", fontWeight: 800, color: "#f0f2ff" }}>
                  {modalStep === "choose" && "How do you want to start?"}
                  {modalStep === "blank" && "Configure your canvas"}
                  {modalStep === "gallery" && "Start from a template"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                style={{
                  background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer",
                  color: "rgba(240,242,255,0.5)",
                  padding: "0.4rem", borderRadius: 8,
                  display: "grid", placeItems: "center",
                  transition: "background 0.15s",
                }}
              >
                <IconX />
              </button>
            </div>

            {modalStep === "choose" && (
              <div style={{ display: "grid", gap: "0.6rem" }}>
                <button
                  type="button"
                  onClick={() => setModalStep("blank")}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.85rem",
                    padding: "1rem", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f0f2ff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: "var(--brand-subtle)", color: "var(--brand)", flexShrink: 0 }}>
                    <IconMail />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 700 }}>Blank canvas</span>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>Start empty and build it yourself.</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalStep("gallery")}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.85rem",
                    padding: "1rem", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f0f2ff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: "rgba(129,140,248,0.12)", color: "#818cf8", flexShrink: 0 }}>
                    <IconStore />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 700 }}>Browse marketplace</span>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>Free and premium templates, ready to customize.</span>
                  </span>
                </button>

                <Link
                  href="/dashboard/templates/upload"
                  onClick={() => setModalOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.85rem",
                    padding: "1rem", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f0f2ff", cursor: "pointer", textDecoration: "none", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.06)", color: "rgba(240,242,255,0.7)", flexShrink: 0 }}>
                    <IconUpload />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 700 }}>Upload a site</span>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>Bring an existing exported HTML site or .zip.</span>
                  </span>
                </Link>
              </div>
            )}

            {modalStep === "blank" && (
              <>
                <button
                  type="button"
                  onClick={() => setModalStep("choose")}
                  style={{ background: "none", border: "none", color: "rgba(240,242,255,0.45)", cursor: "pointer", fontSize: "0.8rem", padding: 0, marginBottom: "1rem", fontFamily: "inherit" }}
                >
                  ← Back
                </button>

                {/* Name */}
                <label style={{ display: "block", marginBottom: "1rem" }}>
                  <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>
                    Template Name
                  </span>
                  <input
                    id="modal-template-name"
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Summer Campaign 2025"
                    onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
                    style={{
                      width: "100%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      color: "#f0f2ff",
                      padding: "0.7rem 0.9rem",
                      fontSize: "0.9rem",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </label>

                {/* Type selector */}
                <div style={{ marginBottom: "1.25rem" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.5rem" }}>
                    Template Type
                  </p>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem",
                  }}>
                    {(["EMAIL","LANDING_PAGE"] as const).map((kind) => {
                      const label = kind === "EMAIL" ? "Email Template" : "Landing Page";
                      const icon = kind === "EMAIL" ? <IconMail /> : <IconLayout />;
                      const active = templateKind === kind;
                      return (
                        <button
                          key={kind}
                          type="button"
                          id={`modal-kind-${kind.toLowerCase()}`}
                          onClick={() => setTemplateKind(kind)}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.6rem",
                            padding: "0.75rem 1rem",
                            borderRadius: 10,
                            border: active ? "1.5px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
                            background: active ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
                            color: active ? "var(--brand)" : "rgba(240,242,255,0.55)",
                            cursor: "pointer", fontFamily: "inherit",
                            fontWeight: active ? 600 : 500, fontSize: "0.875rem",
                            transition: "all 0.15s",
                          }}
                        >
                          {icon}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {error && (
                  <p style={{
                    fontSize: "0.82rem", color: "#f87171",
                    marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.4rem",
                  }} role="alert">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {error}
                  </p>
                )}

                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    style={{
                      padding: "0.65rem 1.1rem",
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "rgba(240,242,255,0.65)",
                      cursor: "pointer", fontFamily: "inherit",
                      fontSize: "0.875rem", fontWeight: 600,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    id="modal-create-btn"
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={isCreating}
                    style={{
                      padding: "0.65rem 1.4rem",
                      borderRadius: 9,
                      border: "none",
                      background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                      color: "#fff",
                      cursor: isCreating ? "not-allowed" : "pointer",
                      opacity: isCreating ? 0.7 : 1,
                      fontFamily: "inherit",
                      fontSize: "0.875rem", fontWeight: 700,
                      boxShadow: "0 4px 16px var(--brand-glow)",
                    }}
                  >
                    {isCreating ? "Creating…" : "Create Template"}
                  </button>
                </div>
              </>
            )}

            {modalStep === "gallery" && (
              <>
                <button
                  type="button"
                  onClick={() => setModalStep("choose")}
                  style={{ background: "none", border: "none", color: "rgba(240,242,255,0.45)", cursor: "pointer", fontSize: "0.8rem", padding: 0, marginBottom: "1rem", fontFamily: "inherit" }}
                >
                  ← Back
                </button>
                <NewFromMarketplace onClose={() => setModalOpen(false)} />
              </>
            )}
          </div>
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
                This will permanently delete this template, all attached sub-pages, assets, and unbind custom domain mappings. This action cannot be undone.
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
    </PageContainer>
  );
}
