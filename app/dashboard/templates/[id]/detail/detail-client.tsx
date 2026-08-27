"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer } from "../../../_components/PageContainer";
import { Card } from "../../../_components/Card";
import { CustomSelect } from "../../../../_components/CustomSelect";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

type SiteData = {
  domain: { domain: string; type: string; dnsVerified: boolean; active: boolean } | null;
  pageViews30d: number;
  blogEnabled: boolean;
  siteLayoutEnabled: boolean;
  commerceEnabled: boolean;
};

type PreviewPage = { id: string; name: string; parentId: string | null };

type Props = {
  templateId: string;
  templateName: string;
  templateKind: TemplateKind;
  sourceType: string;
  isBlogLayout: boolean;
  createdAt: string;
  updatedAt: string;
  compiledAt: string | null;
  designJson: unknown;
  compiledHtml: string;
  pageCount: number;
  formSubmissionCount: number;
  siteData: SiteData | null;
};

const CARD_TITLE: React.CSSProperties = { fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", margin: 0 };
const CARD_HEADER: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1.1rem", flexWrap: "wrap" };
const ROW: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.7rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" };
const LABEL: React.CSSProperties = { fontSize: "0.82rem", color: "rgba(240,242,255,0.5)" };
const VALUE: React.CSSProperties = { fontSize: "0.82rem", color: "#f0f2ff", fontWeight: 600 };
const LINK_BTN: React.CSSProperties = { padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.85)", fontSize: "0.78rem", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" };

function IconArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
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
function IconWarning() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IconChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function Chip({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.2rem 0.6rem",
        borderRadius: 999,
        fontSize: "0.72rem",
        fontWeight: 700,
        background: on ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
        color: on ? "#4ade80" : "rgba(240,242,255,0.4)",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {on ? onLabel : offLabel}
    </span>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Strips tags for a rough plain-text view — good enough for "what does this page say",
 * not a faithful text-extraction. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The preview iframe's own srcDoc — scripts stripped before ever reaching the frame, same
 * defensive reasoning plexo-sdk's own CompiledCanvasFrame uses: this is a passive display
 * surface, not a place a real MailDrip embed, checkout redirect, or form submission should
 * actually fire from just because someone opened this site's Detail page. */
function stripScriptTags(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

export function DetailClient({
  templateId,
  templateName,
  templateKind,
  sourceType,
  isBlogLayout,
  createdAt,
  updatedAt,
  compiledAt,
  designJson,
  compiledHtml,
  pageCount,
  formSubmissionCount,
  siteData,
}: Props) {
  const router = useRouter();
  const isEmail = templateKind === "EMAIL";
  const isRawUpload = sourceType === "RAW_UPLOAD";

  const [name, setName] = useState(templateName);
  const [nameDraft, setNameDraft] = useState(templateName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [sourceTab, setSourceTab] = useState<"json" | "html" | "text">("html");
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);

  // Preview: the page this Detail route already has compiledHtml for is seeded straight
  // into the cache — switching to any other page in the site fetches it on demand.
  const [previewPages, setPreviewPages] = useState<PreviewPage[]>([{ id: templateId, name, parentId: null }]);
  const [selectedPreviewId, setSelectedPreviewId] = useState(templateId);
  const [previewCache, setPreviewCache] = useState<Record<string, string>>({ [templateId]: compiledHtml });
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (isEmail) return;
    fetch(`/api/templates/${templateId}/pages`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.pages) setPreviewPages(data.pages);
      })
      .catch(() => {});
    // Run once — the switcher itself is what drives further interaction from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectPreview(id: string) {
    setSelectedPreviewId(id);
    if (previewCache[id] !== undefined) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/templates/${id}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.page) {
        setPreviewCache((prev) => ({ ...prev, [id]: data.page.compiledHtml }));
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRenameCommit() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === name) {
      setNameDraft(name);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNameError(data.error ?? "Couldn't rename.");
        setNameDraft(name);
        return;
      }
      setName(trimmed);
      setNameDraft(trimmed);
      router.refresh();
    } finally {
      setSavingName(false);
    }
  }

  async function handleConvert() {
    setConvertError(null);
    setIsConverting(true);
    try {
      const targetKind = isEmail ? "LANDING_PAGE" : "EMAIL";
      const res = await fetch(`/api/templates/${templateId}/convert-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to convert template.");
      setShowConvertModal(false);
      router.refresh();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "Unable to convert template.");
    } finally {
      setIsConverting(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Unable to delete.");
      }
      router.push("/dashboard/templates");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unable to delete.");
      setIsDeleting(false);
    }
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const domainStatus = siteData?.domain
    ? siteData.domain.type === "CUSTOM"
      ? siteData.domain.active && siteData.domain.dnsVerified
        ? "Live"
        : "Pending DNS"
      : siteData.domain.active
        ? "Live"
        : "Not live"
    : "Not connected";

  const currentCompiledHtml = sourceTab === "html" || sourceTab === "text" ? previewCache[selectedPreviewId] ?? compiledHtml : compiledHtml;
  const sourceText = sourceTab === "json" ? JSON.stringify(designJson, null, 2) : sourceTab === "html" ? currentCompiledHtml : stripTags(currentCompiledHtml);

  const previewHtml = previewCache[selectedPreviewId];
  const previewOptions = previewPages.map((p) => ({ label: p.parentId === null ? `${p.name} (Home)` : p.name, value: p.id }));

  return (
    <PageContainer>
      <Link href="/dashboard/templates" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.5)", textDecoration: "none", marginBottom: "1.5rem" }}>
        <IconArrowLeft /> Templates
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1.5rem", marginBottom: "2rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                padding: "0.2rem 0.6rem", borderRadius: 999,
                fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                background: isEmail ? "var(--brand-subtle)" : "rgba(129,140,248,0.1)",
                color: isEmail ? "var(--brand)" : "#818cf8",
              }}
            >
              {isEmail ? "Email" : "Page"}
            </span>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                padding: "0.2rem 0.6rem", borderRadius: 999,
                fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(240,242,255,0.55)",
              }}
            >
              {isRawUpload ? "Raw Upload" : "Drag & Drop"}
            </span>
          </div>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setNameDraft(name);
            }}
            disabled={savingName}
            style={{
              display: "block",
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "1.9rem",
              fontWeight: 800,
              color: "#f0f2ff",
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 8,
              padding: "0.15rem 0.4rem",
              marginLeft: "-0.4rem",
              width: "100%",
              maxWidth: 560,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
          />
          {nameError && <p style={{ fontSize: "0.75rem", color: "#f87171", marginTop: "0.3rem" }}>{nameError}</p>}
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", marginTop: "0.35rem" }}>
            Updated {formatDateTime(updatedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/templates/${templateId}`)}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.75rem 1.4rem", borderRadius: 10, border: "none", cursor: "pointer",
            fontSize: "0.92rem", fontWeight: 700,
            background: "var(--brand)", color: "#fff",
            fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          Open Editor <IconArrow />
        </button>
      </div>

      <div className="detail-grid">
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", minWidth: 0 }}>
          {/* Preview */}
          <Card>
            <div style={CARD_HEADER}>
              <div>
                <h2 style={CARD_TITLE}>Preview</h2>
                <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
                  {isEmail ? "How this email renders." : "What this page actually looks like, live."}
                </p>
              </div>
              {previewOptions.length > 1 && (
                <div style={{ width: "min(260px, 100%)" }}>
                  <CustomSelect value={selectedPreviewId} options={previewOptions} onChange={(val) => void selectPreview(val)} />
                </div>
              )}
            </div>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 0.75rem", background: "#12172a", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["#f87171", "#fbbf24", "#4ade80"].map((c) => (
                  <span key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c, opacity: 0.7 }} />
                ))}
              </div>
              <div style={{ position: "relative", height: 620 }}>
                {previewLoading && (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.6)" }}>
                    <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                  </div>
                )}
                {previewHtml !== undefined && (
                  <iframe
                    key={selectedPreviewId}
                    srcDoc={stripScriptTags(previewHtml)}
                    title="Page preview"
                    sandbox=""
                    style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                  />
                )}
              </div>
            </div>
          </Card>

          {/* View Source — collapsed by default; a debugging/inspection aid, not something
              most visits to this page need open. */}
          <Card padded={false}>
            <button
              type="button"
              onClick={() => setShowSource((v) => !v)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "1rem", padding: "1.4rem", background: "none", border: "none", cursor: "pointer",
                fontFamily: "inherit", textAlign: "left",
              }}
            >
              <div>
                <h2 style={CARD_TITLE}>View Source</h2>
                <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
                  The compiled HTML, design JSON, or plain text behind this {isEmail ? "email" : "page"}.
                </p>
              </div>
              <span style={{ color: "rgba(240,242,255,0.5)", flexShrink: 0 }}>
                <IconChevronDown open={showSource} />
              </span>
            </button>
            {showSource && (
              <div style={{ padding: "0 1.4rem 1.4rem" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.3rem", marginBottom: "0.75rem" }}>
                  {(["html", "json", "text"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSourceTab(tab)}
                      style={{
                        padding: "0.3rem 0.7rem", borderRadius: 7, border: "none", cursor: "pointer",
                        fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em",
                        background: sourceTab === tab ? "var(--brand-subtle)" : "transparent",
                        color: sourceTab === tab ? "var(--brand)" : "rgba(240,242,255,0.5)",
                      }}
                    >
                      {tab === "text" ? "Plain text" : tab}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleCopy(sourceText)}
                    style={{ padding: "0.3rem 0.7rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre
                  style={{
                    maxHeight: 340,
                    overflow: "auto",
                    fontSize: "0.72rem",
                    lineHeight: 1.5,
                    color: "rgba(240,242,255,0.75)",
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "0.9rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {sourceText}
                </pre>
              </div>
            )}
          </Card>

          {/* Danger zone — bottom of the main column, past preview/source rather than
              competing for space in the status sidebar. */}
          <Card style={{ border: "1px solid rgba(239,68,68,0.2)" }}>
            <h2 style={{ ...CARD_TITLE, color: "#f87171", marginBottom: "0.9rem" }}>Danger Zone</h2>
            <div style={{ ...ROW, borderBottom: "none" }}>
              <div>
                <div style={VALUE}>Delete {isEmail ? "this template" : "this site"}</div>
                <div style={LABEL}>Can&apos;t be undone.</div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
              >
                Delete
              </button>
            </div>
          </Card>
        </div>

        {/* Sidebar column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", minWidth: 0 }}>
          <Card>
            <h2 style={{ ...CARD_TITLE, marginBottom: "0.9rem" }}>Properties</h2>
            <div style={ROW}>
              <span style={LABEL}>Created</span>
              <span style={VALUE}>{formatDateTime(createdAt)}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Last compiled</span>
              <span style={VALUE}>{compiledAt ? formatDateTime(compiledAt) : "Never"}</span>
            </div>
            {!isBlogLayout && (
              <div style={{ ...ROW, borderBottom: "none" }}>
                <span style={LABEL}>Kind</span>
                <button
                  type="button"
                  onClick={() => setShowConvertModal(true)}
                  style={{ padding: "0.3rem 0.7rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(240,242,255,0.75)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}
                >
                  Switch to {isEmail ? "Landing Page" : "Email"}
                </button>
              </div>
            )}
          </Card>

          {siteData && (
            <>
              <Card>
                <h2 style={{ ...CARD_TITLE, marginBottom: "0.9rem" }}>Domain &amp; Traffic</h2>
                <div style={ROW}>
                  <div>
                    <div style={{ ...VALUE, marginBottom: "0.3rem" }}>{siteData.domain?.domain ?? "No domain connected"}</div>
                    <Chip on={domainStatus === "Live"} onLabel="Live" offLabel={domainStatus} />
                  </div>
                  <Link href={`/dashboard/domains?templateId=${templateId}`} style={LINK_BTN}>
                    {siteData.domain ? "Manage" : "Connect"}
                  </Link>
                </div>
                <div style={{ ...ROW, borderBottom: "none" }}>
                  <div>
                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#f0f2ff" }}>{siteData.pageViews30d.toLocaleString()}</div>
                    <div style={LABEL}>page views, last 30 days</div>
                  </div>
                  <Link href={`/dashboard/insights?templateId=${templateId}`} style={LINK_BTN}>
                    View analytics
                  </Link>
                </div>
              </Card>

              <Card>
                <h2 style={{ ...CARD_TITLE, marginBottom: "0.9rem" }}>Site</h2>
                <div style={ROW}>
                  <span style={LABEL}>Site Layout</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <Chip on={siteData.siteLayoutEnabled} onLabel="On" offLabel="Off" />
                    <Link href={`/dashboard/templates/${templateId}/site-layout`} style={LINK_BTN}>Configure</Link>
                  </div>
                </div>
                <div style={ROW}>
                  <span style={LABEL}>Blog</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <Chip on={siteData.blogEnabled} onLabel="On" offLabel="Off" />
                    <Link href={`/dashboard/templates/${templateId}/blog`} style={LINK_BTN}>Manage</Link>
                  </div>
                </div>
                <div style={ROW}>
                  <span style={LABEL}>Commerce</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <Chip on={siteData.commerceEnabled} onLabel="On" offLabel="Off" />
                    <Link href={`/dashboard/commerce/${templateId}/settings`} style={LINK_BTN}>Configure</Link>
                  </div>
                </div>
                <div style={ROW}>
                  <span style={LABEL}>Pages</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <span style={VALUE}>{pageCount + 1}</span>
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/templates/${templateId}`)}
                      style={{ ...LINK_BTN, background: "transparent", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Manage
                    </button>
                  </div>
                </div>
                <div style={ROW}>
                  <span style={LABEL}>Form Submissions</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <span style={VALUE}>{formSubmissionCount}</span>
                    <Link href={`/dashboard/templates/${templateId}/form-submissions`} style={LINK_BTN}>View</Link>
                  </div>
                </div>
                <div style={{ ...ROW, borderBottom: "none" }}>
                  <span style={LABEL}>Transfer Site</span>
                  <Link href={`/dashboard/templates/${templateId}/transfer`} style={LINK_BTN}>Transfer</Link>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Convert modal */}
      {showConvertModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 7, 18, 0.85)", zIndex: 100, display: "grid", placeItems: "center", backdropFilter: "blur(8px)" }}>
          <div style={{ background: "#0d1324", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, width: "90%", maxWidth: 460, padding: "1.75rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f0f2ff", fontFamily: "var(--font-heading)" }}>
                Switch to {isEmail ? "Landing Page" : "Email"}
              </h2>
              <button onClick={() => setShowConvertModal(false)} style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", display: "flex" }}>
                <IconClose />
              </button>
            </div>
            <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", lineHeight: 1.5, marginBottom: "1.25rem" }}>
              {isEmail
                ? "This keeps all your content and design — it'll just be recompiled as a landing page instead of an email."
                : "This keeps all your content and design, but interactive blocks like carousels, videos, timers, menus, and accordions won't animate or respond in email clients — they'll show as static images/snapshots instead."}
            </p>
            {convertError && (
              <p style={{ fontSize: "0.78rem", color: "#f87171", margin: "0 0 1rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <IconWarning /> {convertError}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button type="button" onClick={() => setShowConvertModal(false)} style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(240,242,255,0.8)", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                type="button"
                disabled={isConverting}
                onClick={() => void handleConvert()}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}
              >
                {isConverting ? "Switching…" : "Switch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(3, 7, 18, 0.85)", zIndex: 100, display: "grid", placeItems: "center", backdropFilter: "blur(8px)" }}>
          <div style={{ background: "#0d1324", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, width: "90%", maxWidth: 420, padding: "1.75rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", fontFamily: "var(--font-heading)", marginBottom: "0.75rem" }}>
              Delete &quot;{name}&quot;?
            </h2>
            <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", lineHeight: 1.5, marginBottom: "1.25rem" }}>
              {isEmail
                ? "This email template will be permanently deleted."
                : `This site${pageCount > 0 ? `, all ${pageCount + 1} of its pages,` : ""} and its connected domain (if any) will be permanently deleted.`}
            </p>
            {deleteError && (
              <p style={{ fontSize: "0.78rem", color: "#f87171", margin: "0 0 1rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <IconWarning /> {deleteError}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(240,242,255,0.8)", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .detail-grid {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 1.5rem;
          align-items: start;
        }
        .spinner {
          border: 2px solid rgba(0,0,0,0.1);
          border-top-color: var(--brand);
          border-radius: 50%;
          animation: spin 0.65s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 1000px) {
          .detail-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </PageContainer>
  );
}
