"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../_components/PageHeader";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
};

type CreatePayload = {
  template: TemplateSummary;
};

type Props = {
  initialTemplates: TemplateSummary[];
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function IconMail() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}

function IconLayout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
  );
}

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

function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
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

type FilterKind = "ALL" | TemplateKind;

export function TemplatesClient({ initialTemplates }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateSummary[]>(initialTemplates);
  const [filter, setFilter] = useState<FilterKind>("ALL");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateKind, setTemplateKind] = useState<TemplateKind>("EMAIL");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setTemplateName("");
    setTemplateKind("EMAIL");
  }

  return (
    <div style={{ padding: "2rem 8px", maxWidth: 1500, margin: "0 auto" }}>
      <PageHeader
        eyebrow="Workspace"
        title="Your Templates"
        action={
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <Link
              href="/dashboard/templates/upload"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.65rem 1.2rem",
                borderRadius: 10, fontWeight: 700, fontSize: "0.875rem",
                background: "none", border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(240,242,255,0.85)", textDecoration: "none",
                fontFamily: "inherit",
              }}
            >
              Upload Site
            </Link>
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
          {filtered.map((template) => {
            const isEmail = template.kind === "EMAIL";
            return (
              <article
                key={template.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 16,
                  overflow: "hidden",
                  transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = "var(--brand-glow)";
                  el.style.boxShadow = "0 8px 32px var(--brand-subtle)";
                  el.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = "rgba(255,255,255,0.08)";
                  el.style.boxShadow = "none";
                  el.style.transform = "translateY(0)";
                }}
              >
                {/* Thumbnail / Snapshot Preview */}
                <div style={{
                  height: 180,
                  position: "relative",
                  background: "#080c14",
                  overflow: "hidden",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {template.compiledHtml ? (
                    <div style={{
                      width: "300%",
                      height: "300%",
                      transform: "scale(0.333333)",
                      transformOrigin: "0 0",
                      pointerEvents: "none",
                      position: "absolute",
                      top: 0,
                      left: 0,
                    }}>
                      <iframe
                        srcDoc={template.compiledHtml}
                        title={`Preview ${template.name}`}
                        // Empty sandbox (no tokens, notably no allow-scripts / allow-same-origin):
                        // this is a decorative visual snapshot, not an interactive preview, and
                        // compiledHtml can be raw/unsanitized user HTML now (RAW_UPLOAD templates)
                        // — it must never execute here with this page's own privileges.
                        sandbox=""
                        style={{
                          width: "100%",
                          height: "100%",
                          border: "none",
                          background: "#ffffff",
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{
                      width: "100%",
                      height: "100%",
                      background: isEmail
                        ? "linear-gradient(135deg,rgba(139,92,246,0.12) 0%,rgba(252,6,148,0.03) 100%)"
                        : "linear-gradient(135deg,rgba(129,140,248,0.12) 0%,rgba(129,140,248,0.03) 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isEmail ? "var(--brand)" : "#818cf8",
                    }}>
                      {isEmail ? <IconMail /> : <IconLayout />}
                    </div>
                  )}

                  {/* Overlay Badge */}
                  <span style={{
                    position: "absolute",
                    top: "0.75rem",
                    right: "0.75rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    padding: "0.25rem 0.65rem",
                    borderRadius: 999,
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    background: isEmail ? "var(--brand)" : "#818cf8",
                    color: "#ffffff",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    zIndex: 2,
                  }}>
                    {isEmail ? <IconMail /> : <IconLayout />}
                    {isEmail ? "Email" : "Page"}
                  </span>
                </div>

                {/* Body */}
                <div style={{ padding: "1.1rem" }}>
                  <h2 style={{
                    fontFamily: "var(--font-heading), sans-serif",
                    fontSize: "1rem", fontWeight: 700,
                    color: "#f0f2ff", marginBottom: "0.3rem",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {template.name}
                  </h2>
                  <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    Updated {formatDate(template.updatedAt)}
                    {!isEmail && template.pageCount > 0 && (
                      <span style={{
                        display: "inline-flex", alignItems: "center",
                        padding: "0.1rem 0.5rem", borderRadius: 999,
                        fontSize: "0.68rem", fontWeight: 700,
                        background: "rgba(129,140,248,0.12)", color: "#818cf8",
                      }}>
                        {template.pageCount + 1} pages
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/templates/${template.id}`)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.5rem 1rem",
                      borderRadius: 8, border: "none", cursor: "pointer",
                      fontSize: "0.8rem", fontWeight: 600,
                      background: "var(--brand-subtle)",
                      color: "var(--brand)",
                      transition: "background 0.15s",
                      fontFamily: "inherit",
                    }}
                  >
                    Open Editor
                    <IconArrow />
                  </button>
                </div>
              </article>
            );
          })}
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
            width: "min(100%,480px)",
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
                  Configure your canvas
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
    </div>
  );
}
