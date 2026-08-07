"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../_components/PageHeader";
import { PageContainer } from "../_components/PageContainer";
import { NewFromMarketplace } from "../templates/NewFromMarketplace";
import { formatDate, IconLayout } from "../templates/TemplateCard";
import { CustomSelect } from "../domains/domains-client";

export type BlogSummary = {
  id: string;
  name: string;
  blogTitle: string;
  postCount: number;
  updatedAt: string;
  liveDomain: string | null;
};

export type EligibleTemplate = { id: string; name: string };

type ModalStep = "closed" | "choose" | "blank" | "gallery" | "existing";

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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

function IconBlog({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h11a5 5 0 0 1 5 5v11" />
      <path d="M4 4v16h16" />
      <circle cx="9" cy="15" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 4v7M4 15h5" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function BlogOverviewClient({ blogs, eligibleTemplates }: { blogs: BlogSummary[]; eligibleTemplates: EligibleTemplate[] }) {
  const router = useRouter();
  const [modalStep, setModalStep] = useState<ModalStep>("closed");
  const [blogName, setBlogName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExistingId, setSelectedExistingId] = useState(eligibleTemplates[0]?.id ?? "");
  const [isEnablingExisting, setIsEnablingExisting] = useState(false);

  function closeModal() {
    setModalStep("closed");
    setBlogName("");
    setError(null);
  }

  async function enableBlogAndRedirect(templateId: string) {
    await fetch(`/api/blog/${templateId}/site`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    closeModal();
    router.push(`/dashboard/templates/${templateId}/blog`);
  }

  async function handleEnableExisting(): Promise<void> {
    if (!selectedExistingId) return;
    setIsEnablingExisting(true);
    setError(null);
    try {
      await enableBlogAndRedirect(selectedExistingId);
    } finally {
      setIsEnablingExisting(false);
    }
  }

  async function handleCreateBlank(): Promise<void> {
    if (!blogName.trim()) {
      setError("Blog name is required.");
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: blogName, kind: "LANDING_PAGE" }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to create blog.");
      }
      const payload = (await response.json()) as { template: { id: string } };
      await enableBlogAndRedirect(payload.template.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create blog.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Content"
        title="Blog"
        subtitle="Every site with blogging turned on, in one place."
        action={
          <button
            type="button"
            onClick={() => setModalStep("choose")}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.65rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit",
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", boxShadow: "0 4px 16px var(--brand-glow)",
            }}
          >
            <IconPlus />
            New Blog
          </button>
        }
      />

      {blogs.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
          gap: "0.75rem", padding: "4rem 1.5rem", borderRadius: 16,
          border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)",
        }}>
          <span style={{
            display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 14,
            background: "rgba(16,185,129,0.1)", color: "#10b981",
          }}>
            <IconBlog size={24} />
          </span>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>
            No active blogs yet
          </h2>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", maxWidth: 420 }}>
            Start a new blog from a blank canvas or a marketplace template, or enable blogging
            on an existing site from its editor's Blog tab.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {blogs.map((blog) => (
            <article
              key={blog.id}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                padding: "1.1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                <span style={{
                  display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10,
                  background: "rgba(16,185,129,0.1)", color: "#10b981", flexShrink: 0,
                }}>
                  <IconBlog size={18} />
                </span>
                <span style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "0.15rem 0.55rem", borderRadius: 999,
                  fontSize: "0.68rem", fontWeight: 700,
                  background: "rgba(129,140,248,0.12)", color: "#818cf8",
                }}>
                  {blog.postCount} {blog.postCount === 1 ? "post" : "posts"}
                </span>
              </div>

              <h2 style={{
                fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700,
                color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {blog.blogTitle}
              </h2>
              <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>
                {blog.name} · Updated {formatDate(blog.updatedAt)}
              </p>

              {blog.liveDomain ? (
                <a
                  href={`https://${blog.liveDomain}/blog`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.78rem", color: "#4ade80", textDecoration: "none" }}
                >
                  {blog.liveDomain} <IconExternal />
                </a>
              ) : (
                <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)" }}>Not published yet</span>
              )}

              <button
                type="button"
                onClick={() => router.push(`/dashboard/templates/${blog.id}/blog`)}
                style={{
                  marginTop: "0.35rem",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                  padding: "0.6rem 1rem", borderRadius: 10, border: "none", cursor: "pointer",
                  fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit",
                  background: "rgba(139,92,246,0.15)", color: "var(--brand)",
                }}
              >
                Manage Blog
              </button>
            </article>
          ))}
        </div>
      )}

      {/* ── NEW BLOG MODAL ────────────────────────── */}
      {modalStep !== "closed" && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(5,6,12,0.7)",
            backdropFilter: "blur(4px)", display: "grid", placeItems: "center",
            zIndex: 100, padding: "1rem",
          }}
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(440px, 100%)", background: "rgba(16,18,28,0.98)",
              border: "1px solid rgba(255,255,255,0.09)", borderRadius: 18,
              padding: "1.5rem", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
              <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>
                {modalStep === "choose" && "How do you want to start?"}
                {modalStep === "blank" && "Name your blog"}
                {modalStep === "gallery" && "Start from a template"}
                {modalStep === "existing" && "Use an existing page"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close modal"
                style={{
                  background: "rgba(255,255,255,0.06)", border: "none", cursor: "pointer",
                  color: "rgba(240,242,255,0.5)", padding: "0.4rem", borderRadius: 8,
                  display: "grid", placeItems: "center",
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
                    display: "flex", alignItems: "center", gap: "0.85rem", padding: "1rem", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
                    color: "#f0f2ff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#10b981", flexShrink: 0 }}>
                    <IconBlog />
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
                    display: "flex", alignItems: "center", gap: "0.85rem", padding: "1rem", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
                    color: "#f0f2ff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: "rgba(129,140,248,0.12)", color: "#818cf8", flexShrink: 0 }}>
                    <IconStore />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 700 }}>Start from a template</span>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>Clone a marketplace template, blogging enabled automatically.</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalStep("existing")}
                  disabled={eligibleTemplates.length === 0}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.85rem", padding: "1rem", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
                    color: eligibleTemplates.length === 0 ? "rgba(240,242,255,0.35)" : "#f0f2ff",
                    cursor: eligibleTemplates.length === 0 ? "not-allowed" : "pointer",
                    textAlign: "left", fontFamily: "inherit", opacity: eligibleTemplates.length === 0 ? 0.6 : 1,
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: "rgba(129,140,248,0.12)", color: "#818cf8", flexShrink: 0 }}>
                    <IconLayout />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 700 }}>Use an existing page</span>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>
                      {eligibleTemplates.length === 0 ? "No eligible pages — every landing page already has blogging on." : "Turn on blogging for a landing page you already built."}
                    </span>
                  </span>
                </button>
              </div>
            )}

            {modalStep === "existing" && (
              <>
                <button
                  type="button"
                  onClick={() => setModalStep("choose")}
                  style={{ background: "none", border: "none", color: "rgba(240,242,255,0.45)", cursor: "pointer", fontSize: "0.8rem", padding: 0, marginBottom: "1rem", fontFamily: "inherit" }}
                >
                  ← Back
                </button>

                <label style={{ display: "block", marginBottom: "1.25rem" }}>
                  <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>
                    Page
                  </span>
                  <CustomSelect
                    value={selectedExistingId}
                    options={eligibleTemplates.map((t) => ({ label: t.name, value: t.id }))}
                    onChange={setSelectedExistingId}
                  />
                </label>

                {error && (
                  <p style={{ fontSize: "0.82rem", color: "#f87171", marginBottom: "1rem" }} role="alert">
                    {error}
                  </p>
                )}

                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={closeModal}
                    style={{
                      padding: "0.65rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer",
                      fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 600,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleEnableExisting()}
                    disabled={isEnablingExisting || !selectedExistingId}
                    style={{
                      padding: "0.65rem 1.4rem", borderRadius: 9, border: "none",
                      background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
                      cursor: isEnablingExisting ? "not-allowed" : "pointer", opacity: isEnablingExisting ? 0.7 : 1,
                      fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 700,
                      boxShadow: "0 4px 16px var(--brand-glow)",
                    }}
                  >
                    {isEnablingExisting ? "Enabling…" : "Enable Blog"}
                  </button>
                </div>
              </>
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

                <label style={{ display: "block", marginBottom: "1.25rem" }}>
                  <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>
                    Blog Name
                  </span>
                  <input
                    type="text"
                    value={blogName}
                    onChange={(e) => setBlogName(e.target.value)}
                    placeholder="Company Blog"
                    onKeyDown={(e) => { if (e.key === "Enter") void handleCreateBlank(); }}
                    style={{
                      width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10, color: "#f0f2ff", padding: "0.7rem 0.9rem", fontSize: "0.9rem",
                      outline: "none", fontFamily: "inherit",
                    }}
                  />
                </label>

                {error && (
                  <p style={{ fontSize: "0.82rem", color: "#f87171", marginBottom: "1rem" }} role="alert">
                    {error}
                  </p>
                )}

                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={closeModal}
                    style={{
                      padding: "0.65rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer",
                      fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 600,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateBlank()}
                    disabled={isCreating}
                    style={{
                      padding: "0.65rem 1.4rem", borderRadius: 9, border: "none",
                      background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
                      cursor: isCreating ? "not-allowed" : "pointer", opacity: isCreating ? 0.7 : 1,
                      fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 700,
                      boxShadow: "0 4px 16px var(--brand-glow)",
                    }}
                  >
                    {isCreating ? "Creating…" : "Create Blog"}
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
                <NewFromMarketplace onClose={closeModal} onCreated={(id) => void enableBlogAndRedirect(id)} />
              </>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
