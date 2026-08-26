"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageContainer } from "../../../_components/PageContainer";

const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.25rem", background: "rgba(255,255,255,0.02)" };
const FIELD_LABEL: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" };
const inputStyle: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" };

type Warning = { title: string; detail: string };
type PendingTransfer = { id: string; toEmail: string; createdAt: string; expiresAt: string };

export function TransferSiteClient({ templateId, siteName }: { templateId: string; siteName: string }) {
  const [pending, setPending] = useState<PendingTransfer | null | undefined>(undefined);
  const [toEmail, setToEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ recipientExists: boolean; warnings: Warning[] } | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/templates/${templateId}/transfer`)
      .then((r) => r.json())
      .then((d) => setPending(d.pending ?? null))
      .catch(() => setPending(null));
  }, [templateId]);

  async function handleCheck() {
    setError(null);
    setPreview(null);
    if (!toEmail.trim() || !toEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/templates/${templateId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to check this transfer.");
      setPreview({ recipientExists: data.recipientExists, warnings: data.warnings ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check this transfer.");
    } finally {
      setChecking(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send the transfer request.");
      setSent(true);
      setPending({ id: data.request.id, toEmail: data.request.toEmail, createdAt: data.request.createdAt, expiresAt: data.request.expiresAt });
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the transfer request.");
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/transfer`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel the transfer.");
      setPending(null);
      setSent(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel the transfer.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <PageContainer style={{ maxWidth: 640 }}>
      <Link href={`/dashboard/templates/${templateId}`} style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", textDecoration: "none", display: "inline-block", marginBottom: "0.75rem" }}>
        ← Back to editor
      </Link>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: "0 0 0.25rem" }}>Transfer &quot;{siteName}&quot;</h1>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.5rem" }}>
        Move full ownership of this site — every page, and any Commerce catalog/orders it has — to another Plexo account. They'll get an email and have to explicitly accept before anything moves.
      </p>

      {pending === undefined ? null : pending ? (
        <div style={PANEL}>
          <div style={{ fontSize: "0.85rem", color: "#f0f2ff", fontWeight: 600, marginBottom: 4 }}>
            Transfer pending to {pending.toEmail}
          </div>
          <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginBottom: "1rem" }}>
            Sent {new Date(pending.createdAt).toLocaleDateString()} — expires {new Date(pending.expiresAt).toLocaleDateString()}.
            They haven't responded yet.
          </div>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={cancelling}
            style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.8rem", cursor: cancelling ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600 }}
          >
            {cancelling ? "Cancelling…" : "Cancel transfer"}
          </button>
        </div>
      ) : (
        <div style={PANEL}>
          <label>
            <span style={FIELD_LABEL}>Recipient's email</span>
            <input type="email" value={toEmail} onChange={(e) => { setToEmail(e.target.value); setPreview(null); setSent(false); }} placeholder="them@example.com" style={inputStyle} />
          </label>

          {error && <p style={{ fontSize: "0.82rem", color: "#f87171", marginTop: "0.75rem" }}>{error}</p>}

          {sent ? (
            <p style={{ fontSize: "0.85rem", color: "#34d399", marginTop: "1rem" }}>
              Transfer request sent to {toEmail}. They'll need to accept it from their own Plexo dashboard.
            </p>
          ) : preview ? (
            <div style={{ marginTop: "1rem" }}>
              {!preview.recipientExists && (
                <p style={{ fontSize: "0.8rem", color: "#fbbf24", marginBottom: "0.75rem" }}>
                  No Plexo account exists for this email yet — they'll be prompted to create one before they can accept.
                </p>
              )}
              {preview.warnings.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#fbbf24", marginBottom: "0.5rem" }}>
                    {preview.warnings.length} thing{preview.warnings.length === 1 ? "" : "s"} may not work correctly for them:
                  </div>
                  {preview.warnings.map((w, i) => (
                    <div key={i} style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 9, padding: "0.7rem 0.9rem", marginBottom: "0.5rem" }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#f0f2ff" }}>{w.title}</div>
                      <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.6)", marginTop: 2, lineHeight: 1.5 }}>{w.detail}</div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending}
                style={{ padding: "0.6rem 1.2rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: sending ? "not-allowed" : "pointer", opacity: sending ? 0.7 : 1, fontFamily: "inherit" }}
              >
                {sending ? "Sending…" : "Send transfer request"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleCheck()}
              disabled={checking}
              style={{ marginTop: "1rem", padding: "0.6rem 1.2rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#f0f2ff", fontSize: "0.85rem", fontWeight: 600, cursor: checking ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {checking ? "Checking…" : "Review transfer"}
            </button>
          )}
        </div>
      )}
    </PageContainer>
  );
}
