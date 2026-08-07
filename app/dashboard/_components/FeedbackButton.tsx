"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

function IconFeedback() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Small icon-button + modal for submitting product feedback — placed next to
 * NotificationBell in both dashboard shells (the one spot already shared across layout
 * modes), so it doesn't need separate nav-item plumbing per shell. */
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
    if (submitted) {
      setMessage("");
      setSubmitted(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Please enter your feedback.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), pageUrl: pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to submit feedback.");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#f0f2ff", padding: "0.4rem", borderRadius: 8, display: "flex", alignItems: "center",
        }}
      >
        <IconFeedback />
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(3, 7, 18, 0.85)", display: "grid", placeItems: "center",
            backdropFilter: "blur(8px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div
            style={{
              background: "#0d1324", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
              width: "90%", maxWidth: 440, padding: "1.75rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", fontFamily: "var(--font-heading)", margin: 0 }}>
                Send feedback
              </h2>
              <button
                onClick={close}
                style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <IconClose />
              </button>
            </div>

            {submitted ? (
              <div>
                <p style={{ fontSize: "0.85rem", color: "#34d399", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <IconCheck /> Thanks — your feedback has been sent to the team.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="btn-secondary"
                  style={{ padding: "0.6rem 1.2rem" }}
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", margin: 0 }}>
                  Found a bug, or have an idea? Let us know.
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={5}
                  autoFocus
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, color: "#f0f2ff", padding: "0.75rem 0.9rem", fontSize: "0.9rem",
                    outline: "none", fontFamily: "inherit", resize: "vertical",
                  }}
                />
                {error && <p style={{ color: "#f87171", fontSize: "0.82rem", margin: 0 }}>{error}</p>}
                <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={close} className="btn-secondary" style={{ padding: "0.6rem 1.1rem" }}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary"
                    style={{ padding: "0.6rem 1.2rem", cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}
                  >
                    {submitting ? "Sending…" : "Send feedback"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
