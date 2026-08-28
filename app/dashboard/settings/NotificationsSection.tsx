"use client";

import { useState } from "react";

type NotificationKey = "formSubmissions" | "blogComments" | "payments" | "commentMentions";

type Props = {
  initial: {
    formSubmissions: boolean;
    blogComments: boolean;
    payments: boolean;
    commentMentions: boolean;
    notificationEmail: string | null;
  };
};

const ROWS: Array<{ key: NotificationKey; label: string; desc: string }> = [
  { key: "formSubmissions", label: "Form submissions", desc: "Someone submits a form (contact, opt-in, etc.) on one of your sites." },
  { key: "blogComments", label: "Blog comments", desc: "Someone leaves a comment awaiting your review on one of your sites." },
  { key: "payments", label: "Payments received", desc: "A customer completes a paid order on one of your Commerce-enabled sites." },
  { key: "commentMentions", label: "Comment mentions", desc: "Someone @mentions you in a template's internal comments." },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NotificationsSection({ initial }: Props) {
  const [prefs, setPrefs] = useState(initial);
  const [savingKey, setSavingKey] = useState<NotificationKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [emailDraft, setEmailDraft] = useState(initial.notificationEmail ?? "");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function patch(body: Record<string, boolean | string | null>): Promise<boolean> {
    const res = await fetch("/api/v1/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Unable to update this setting.");
    }
    return true;
  }

  async function onToggle(key: NotificationKey): Promise<void> {
    const next = !prefs[key];
    setPrefs((prev) => ({ ...prev, [key]: next }));
    setSavingKey(key);
    setError(null);
    try {
      await patch({ [key]: next });
    } catch (err) {
      setPrefs((prev) => ({ ...prev, [key]: !next }));
      setError(err instanceof Error ? err.message : "Unable to update this setting.");
    } finally {
      setSavingKey(null);
    }
  }

  async function onEmailBlur(): Promise<void> {
    const trimmed = emailDraft.trim();
    if (trimmed === (prefs.notificationEmail ?? "")) return;
    if (trimmed && !EMAIL_PATTERN.test(trimmed)) {
      setEmailError("That doesn't look like a valid email address.");
      return;
    }
    setEmailSaving(true);
    setEmailError(null);
    try {
      await patch({ notificationEmail: trimmed || null });
      setPrefs((prev) => ({ ...prev, notificationEmail: trimmed || null }));
    } catch (err) {
      setEmailDraft(prefs.notificationEmail ?? "");
      setEmailError(err instanceof Error ? err.message : "Unable to update this setting.");
    } finally {
      setEmailSaving(false);
    }
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "1.5rem" }}>
      <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
        Notifications
      </h2>
      <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", maxWidth: 560, marginBottom: "1.25rem" }}>
        Which activity across your sites emails you, and where. Account-security emails (verification, password reset) and things you're actively
        waiting on (org invites, site transfer requests) always send regardless of these.
      </p>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {ROWS.map((row, idx) => (
          <div
            key={row.key}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
              padding: "0.9rem 0", borderBottom: idx < ROWS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
            }}
          >
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.2rem" }}>{row.label}</p>
              <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>{row.desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[row.key]}
              onClick={() => void onToggle(row.key)}
              style={{
                position: "relative", width: 44, height: 24, borderRadius: 999, flexShrink: 0,
                background: prefs[row.key] ? "var(--brand)" : "rgba(255,255,255,0.1)",
                border: prefs[row.key] ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                cursor: savingKey === row.key ? "default" : "pointer",
                transition: "background 0.2s, border-color 0.2s",
              }}
            >
              <span
                style={{
                  position: "absolute", top: 3, left: prefs[row.key] ? 22 : 3,
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            </button>
          </div>
        ))}
      </div>
      {error && <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>{error}</p>}

      <div style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <label htmlFor="notification-email" style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.3rem" }}>
          Send to
        </label>
        <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginBottom: "0.6rem" }}>
          Leave blank to use your own account email. Point it somewhere else — a shared team inbox, say — to redirect all of the above there instead.
        </p>
        <input
          id="notification-email"
          type="email"
          value={emailDraft}
          onChange={(e) => setEmailDraft(e.target.value)}
          onBlur={() => void onEmailBlur()}
          disabled={emailSaving}
          placeholder="you@example.com"
          style={{
            width: "100%", maxWidth: 360, padding: "0.55rem 0.8rem", borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)",
            color: "#f0f2ff", fontSize: "0.85rem", fontFamily: "inherit",
          }}
        />
        {emailError && <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.5rem" }}>{emailError}</p>}
      </div>
    </div>
  );
}
