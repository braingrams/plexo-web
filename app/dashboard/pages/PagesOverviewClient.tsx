"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../_components/PageHeader";
import { formatDate } from "../templates/TemplateCard";
import { SiteImportPanel } from "../templates/[id]/site-import/SiteImportPanel";

export type PublishedPageSummary = {
  id: string;
  name: string;
  compiledHtml: string;
  updatedAt: string;
  pageCount: number;
  domains: string[];
};

function IconLayout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
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

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconPages({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H8a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-4z" />
      <path d="M14 3v4h5" />
      <line x1="10" y1="13" x2="16" y2="13" />
      <line x1="10" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function PublishedPageCard({ page }: { page: PublishedPageSummary }) {
  const router = useRouter();
  const [imageError, setImageError] = useState(false);
  const primaryDomain = page.domains[0];

  return (
    <article
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
      <div style={{ height: 180, position: "relative", background: "#080c14", overflow: "hidden", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {page.compiledHtml && !imageError ? (
          <img
            src={`/api/v1/templates/${page.id}/snapshot`}
            alt={`Preview of ${page.name}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center", border: "none" }}
            onError={() => setImageError(true)}
          />
        ) : null}
        <div style={{
          display: (page.compiledHtml && !imageError) ? "none" : "flex",
          width: "100%", height: "100%",
          background: "linear-gradient(135deg,rgba(129,140,248,0.12) 0%,rgba(129,140,248,0.03) 100%)",
          alignItems: "center", justifyContent: "center", color: "#818cf8",
        }}>
          <IconLayout />
        </div>

        <span style={{
          position: "absolute", top: "0.75rem", right: "0.75rem",
          display: "inline-flex", alignItems: "center", gap: "0.3rem",
          padding: "0.25rem 0.65rem", borderRadius: 999,
          fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          background: "#818cf8", color: "#ffffff", boxShadow: "0 4px 12px rgba(0,0,0,0.5)", zIndex: 2,
        }}>
          {page.pageCount + 1} pages
        </span>
      </div>

      <div style={{ padding: "1.1rem" }}>
        <h2 style={{
          fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700,
          color: "#f0f2ff", marginBottom: "0.3rem",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {page.name}
        </h2>
        <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", marginBottom: "0.6rem" }}>
          Updated {formatDate(page.updatedAt)}
        </p>

        {primaryDomain && (
          <a
            href={`https://${primaryDomain}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem", marginBottom: "1rem",
              fontSize: "0.78rem", color: "#4ade80", textDecoration: "none",
            }}
          >
            {primaryDomain} <IconExternal />
            {page.domains.length > 1 && (
              <span style={{ color: "rgba(240,242,255,0.4)" }}>+{page.domains.length - 1} more</span>
            )}
          </a>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/templates/${page.id}`)}
            style={{
              flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
              padding: "0.6rem 1rem", borderRadius: 10, border: "none", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: 700, background: "rgba(139,92,246,0.15)", color: "var(--brand)",
              transition: "all 0.2s", fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.25)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.15)"; }}
          >
            Open Editor
            <IconArrow />
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * "Add new" on this overview creates a brand-new root site on the spot and immediately opens
 * the import panel for it — there's nothing to import INTO yet otherwise, since this page only
 * ever lists templates that already have sub-pages (see page.tsx's `pages: { some: {} }`
 * filter). Cancelling before a job is ever started deletes that placeholder site again, so
 * backing out doesn't litter the account with empty untitled sites.
 */
function AddNewSiteFlow({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [jobStarted, setJobStarted] = useState(false);

  async function start() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Site", kind: "LANDING_PAGE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to create a new site.");
      setTemplateId(data.template.id);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create a new site.");
    } finally {
      setCreating(false);
    }
  }

  async function close() {
    const idToClean = !jobStarted ? templateId : null;
    setOpen(false);
    setTemplateId(null);
    setJobStarted(false);
    if (idToClean) {
      await fetch(`/api/templates/${idToClean}`, { method: "DELETE" }).catch(() => {});
    }
    onDone();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={creating}
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.65rem 1.2rem",
          borderRadius: 10, fontWeight: 700, fontSize: "0.875rem",
          background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
          color: "#fff", border: "none", cursor: creating ? "default" : "pointer",
          boxShadow: "0 4px 20px var(--brand-glow)",
          fontFamily: "inherit", opacity: creating ? 0.7 : 1,
        }}
      >
        <IconPlus />
        {creating ? "Creating…" : "Add new"}
      </button>
      {error && <p style={{ color: "#f87171", fontSize: "0.78rem", marginTop: "0.5rem" }}>{error}</p>}

      {open && templateId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) void close(); }}
        >
          <div style={{ width: "min(100%,560px)", maxHeight: "80vh", overflowY: "auto", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, boxShadow: "0 30px 100px rgba(0,0,0,0.7)", padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div>
                <p style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.2rem" }}>New multi-page site</p>
                <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "#f0f2ff" }}>Import a website</h2>
              </div>
              <button type="button" onClick={() => void close()} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, padding: "0.4rem", color: "rgba(240,242,255,0.5)", cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <SiteImportPanel
              templateId={templateId}
              onImported={() => { setJobStarted(true); onDone(); }}
              onClose={() => void close()}
            />
          </div>
        </div>
      )}
    </>
  );
}

export function PagesOverviewClient({ pages, isUltra }: { pages: PublishedPageSummary[]; isUltra: boolean }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Pages"
        subtitle="Every multi-page site you've built, published or not."
        action={isUltra ? <AddNewSiteFlow onDone={refresh} /> : undefined}
      />

      {pages.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
          gap: "0.75rem", padding: "4rem 1.5rem", borderRadius: 16,
          border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)",
        }}>
          <span style={{
            display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 14,
            background: "rgba(129,140,248,0.12)", color: "#818cf8",
          }}>
            <IconPages />
          </span>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff" }}>
            No multi-page sites yet
          </h2>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", maxWidth: 420 }}>
            {isUltra
              ? 'Click "Add new" above to import an existing website, or add a sub-page to one of your templates from its editor.'
              : "Add a sub-page to one of your templates from its editor to see it here."}
          </p>
          <Link
            href="/dashboard/templates"
            style={{
              marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.6rem 1.1rem", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700,
              background: "rgba(139,92,246,0.15)", color: "var(--brand)", textDecoration: "none",
            }}
          >
            Go to Templates
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {pages.map((page) => (
            <PublishedPageCard key={page.id} page={page} />
          ))}
        </div>
      )}
    </>
  );
}
