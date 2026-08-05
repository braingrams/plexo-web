"use client";

import { useRouter } from "next/navigation";

export type TemplateKind = "EMAIL" | "LANDING_PAGE";

export type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  compiledHtml: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function IconMail() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}

export function IconLayout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
  );
}

export function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

type Props = {
  template: TemplateSummary;
  /** Omit to hide the delete button — e.g. the Overview page's read-mostly gallery. */
  onDelete?: (template: TemplateSummary) => void;
};

/** Shared template card — thumbnail snapshot, kind badge, name, updated date, page-count
 * pill, Open Editor button. Used by both the Templates page's grid and the Overview page's
 * "front and center" gallery so the two always look identical. */
export function TemplateCard({ template, onDelete }: Props) {
  const router = useRouter();
  const isEmail = template.kind === "EMAIL";

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
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
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(template)}
              title="Delete Template"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                padding: "0.55rem 0.75rem",
                borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.25)", cursor: "pointer",
                fontSize: "0.8rem", fontWeight: 600,
                background: "rgba(239, 68, 68, 0.1)",
                color: "#f87171",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
            >
              <IconTrash />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
