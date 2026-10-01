"use client";

import { useEffect, useMemo, useState } from "react";

type Submission = {
  id: string;
  formName: string;
  fields: Record<string, string>;
  createdAt: string;
  likelySpam: boolean;
};

function IconInbox() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  );
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Forms have no fixed schema — every field a site owner adds becomes its own key in
 * `fields`. Finding "the" email/name to act on means scanning for a key that looks like
 * one (case-insensitive "email"/"name") whose value is actually shaped like that, rather
 * than assuming a fixed field name every form happens to use. */
function findFieldByKeyword(fields: [string, string][], keyword: string): string | null {
  const match = fields.find(([key]) => key.toLowerCase().includes(keyword));
  return match ? match[1] : null;
}

function findSubmissionEmail(fields: [string, string][]): string | null {
  const byKey = findFieldByKeyword(fields, "email");
  if (byKey && EMAIL_PATTERN.test(byKey.trim())) return byKey.trim();
  const byShape = fields.find(([, value]) => EMAIL_PATTERN.test(value.trim()));
  return byShape ? byShape[1].trim() : null;
}

function buildMailtoHref(email: string, formName: string, senderName: string | null): string {
  const subject = `Re: your ${formName} submission`;
  const body = senderName ? `Hi ${senderName},\n\n` : "";
  return `mailto:${email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}

function messagePreview(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  const messageField = entries.find(([key]) => /message|comment|enquiry|inquiry/i.test(key));
  const value = messageField ? messageField[1] : entries.map(([, v]) => v).join(" · ");
  return value.length > 140 ? `${value.slice(0, 140)}…` : value;
}

export function FormSubmissionsClient({ templateId }: { templateId: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<Submission | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch(`/api/v1/templates/${templateId}/form-submissions`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load submissions.");
        setSubmissions(data.submissions);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load submissions."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const likelySpamIds = useMemo(() => submissions.filter((s) => s.likelySpam).map((s) => s.id), [submissions]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === submissions.length ? new Set() : new Set(submissions.map((s) => s.id))));
  }

  function selectLikelySpam() {
    setSelected(new Set(likelySpamIds));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} message${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/form-submissions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete.");
      setSelected(new Set());
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <p style={{ color: "rgba(240,242,255,0.4)", fontSize: "0.85rem" }}>Loading…</p>;
  if (error) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", borderRadius: 14, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)", color: "#f87171", fontSize: "0.85rem" }}>
        {error}
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div style={{ padding: "3.5rem 2rem", textAlign: "center", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 14, background: "rgba(255,255,255,0.04)", color: "rgba(240,242,255,0.3)", marginBottom: "1rem" }}>
          <IconInbox />
        </div>
        <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(240,242,255,0.7)" }}>No submissions yet</p>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", marginTop: "0.3rem" }}>
          Messages sent through a form on this site will show up here.
        </p>
      </div>
    );
  }

  const viewingFields = viewing ? Object.entries(viewing.fields) : [];
  const viewingEmail = viewing ? findSubmissionEmail(viewingFields) : null;
  const viewingName = viewing ? findFieldByKeyword(viewingFields, "name") : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.55)", cursor: "pointer" }}>
            <input type="checkbox" checked={selected.size > 0 && selected.size === submissions.length} onChange={toggleAll} />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          {likelySpamIds.length > 0 && (
            <button
              type="button"
              onClick={selectLikelySpam}
              style={{ padding: "0.35rem 0.7rem", borderRadius: 8, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)", color: "#f59e0b", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" }}
            >
              Select {likelySpamIds.length} likely spam
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={deleteSelected}
            disabled={deleting}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.45rem 0.9rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: "0.8rem", fontWeight: 700, cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.6 : 1 }}
          >
            <IconTrash /> {deleting ? "Deleting…" : `Delete selected (${selected.size})`}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        {submissions.map((s, i) => {
          const fields = Object.entries(s.fields);
          const email = findSubmissionEmail(fields);
          const senderName = findFieldByKeyword(fields, "name");
          return (
            <div
              key={s.id}
              style={{
                display: "flex", alignItems: "center", gap: "1rem", padding: "0.9rem 1rem",
                borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                background: selected.has(s.id) ? "rgba(129,140,248,0.06)" : "transparent",
              }}
            >
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />
              <div style={{ flex: "0 0 130px" }}>
                <span style={{ display: "inline-flex", padding: "0.2rem 0.55rem", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: "rgba(129,140,248,0.1)", color: "#818cf8" }}>
                  {s.formName}
                </span>
              </div>
              <div style={{ flex: "0 0 170px", fontSize: "0.78rem", color: "rgba(240,242,255,0.7)" }}>{senderName || email || "—"}</div>
              <div style={{ flex: "1", minWidth: 0, fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {messagePreview(s.fields)}
              </div>
              {s.likelySpam && (
                <span style={{ flex: "0 0 auto", fontSize: "0.68rem", fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.1)", padding: "0.2rem 0.5rem", borderRadius: 999 }}>
                  Likely spam
                </span>
              )}
              <div style={{ flex: "0 0 130px", fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", textAlign: "right" }}>{formatDateTime(s.createdAt)}</div>
              <button
                type="button"
                onClick={() => setViewing(s)}
                style={{ flex: "0 0 auto", padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" }}
              >
                View
              </button>
            </div>
          );
        })}
      </div>

      {viewing && (
        <>
          <div
            onClick={() => setViewing(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", zIndex: 9998 }}
          />
          <div
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, width: "100%", maxWidth: "560px",
              background: "rgba(18,16,36,0.98)", backdropFilter: "blur(20px)",
              borderLeft: "1px solid rgba(255,255,255,0.08)", boxShadow: "-10px 0 40px rgba(0,0,0,0.5)",
              zIndex: 9999, padding: "2.2rem 2rem", overflowY: "auto",
              display: "flex", flexDirection: "column", gap: "1.5rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>{viewing.formName}</h3>
                <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>{formatDateTime(viewing.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewing(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.35)", padding: "0.25rem", lineHeight: 1 }}
              >
                <IconClose />
              </button>
            </div>

            {viewingEmail && (
              <a
                href={buildMailtoHref(viewingEmail, viewing.formName, viewingName)}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", width: "fit-content", padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(var(--brand-rgb),0.25)", background: "rgba(var(--brand-rgb),0.1)", color: "var(--brand)", fontSize: "0.8rem", fontWeight: 700, textDecoration: "none" }}
              >
                <IconMail /> Reply by email
              </a>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              {viewingFields.map(([key, value]) => (
                <div key={key}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.35)", marginBottom: "0.3rem" }}>
                    {key}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#f0f2ff", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
