"use client";

import { FormEvent, useState } from "react";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

type Props = {
  userId: string;
  initialName: string;
  email: string;
  subscriptionPlan: string;
  memberSince: string;
};

const PLAN_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  FREE: { bg: "rgba(255,255,255,0.06)", color: "rgba(240,242,255,0.55)", border: "rgba(255,255,255,0.1)" },
  PRO: { bg: "rgba(252,6,148,0.1)", color: "#fc0694", border: "rgba(252,6,148,0.25)" },
  ULTRA: { bg: "rgba(129,140,248,0.1)", color: "#818cf8", border: "rgba(129,140,248,0.25)" },
};

function IconUser() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="5"/>
      <path d="M3 21c0-5 3.6-8 9-8s9 3 9 8"/>
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

export function ProfileClient({ userId: _userId, initialName, email, subscriptionPlan, memberSince }: Props) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || email.slice(0, 2).toUpperCase();

  const planStyle = PLAN_COLORS[subscriptionPlan.toUpperCase()] ?? PLAN_COLORS.FREE;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft.trim()) {
      setError("Display name cannot be empty.");
      return;
    }
    if (draft.trim() === name) {
      setNotice("No changes to save.");
      return;
    }
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.trim() }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to update profile.");
      }
      setName(draft.trim());
      setNotice("Profile updated successfully.");
      setTimeout(() => setNotice(null), 3000);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "2rem 1.75rem", maxWidth: 760, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fc0694", marginBottom: "0.35rem" }}>
          Account
        </p>
        <h1 style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontSize: "clamp(1.6rem, 3vw, 2.1rem)",
          fontWeight: 800, letterSpacing: "-0.025em", color: "#f0f2ff",
        }}>
          Your Profile
        </h1>
        <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", marginTop: "0.35rem" }}>
          Manage your personal information and account preferences.
        </p>
      </div>

      {/* Avatar + info card */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16, padding: "1.75rem",
        marginBottom: "1.5rem",
        display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap",
      }}>
        {/* Avatar */}
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "linear-gradient(135deg,#fc0694,#d4057d)",
          display: "grid", placeItems: "center",
          fontSize: "1.5rem", fontWeight: 800, color: "#fff",
          fontFamily: "var(--font-heading), sans-serif",
          boxShadow: "0 0 28px rgba(252,6,148,0.4)",
          flexShrink: 0,
          letterSpacing: "-0.02em",
        }}>
          {initials || <IconUser />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "1.2rem", fontWeight: 700, color: "#f0f2ff",
            marginBottom: "0.3rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {name || "Unnamed User"}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem",
              fontSize: "0.82rem", color: "rgba(240,242,255,0.45)",
            }}>
              <IconMail />
              {email}
            </span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem",
              fontSize: "0.82rem", color: "rgba(240,242,255,0.35)",
            }}>
              <IconCalendar />
              Member since {formatDate(memberSince)}
            </span>
          </div>
        </div>

        {/* Plan badge */}
        <span style={{
          display: "inline-flex", alignItems: "center",
          padding: "0.3rem 0.85rem",
          borderRadius: 999,
          fontSize: "0.72rem", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase",
          background: planStyle.bg,
          color: planStyle.color,
          border: `1px solid ${planStyle.border}`,
          flexShrink: 0,
        }}>
          {subscriptionPlan}
        </span>
      </div>

      {/* Edit form */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16, padding: "1.75rem",
      }}>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.3rem" }}>
          Edit Profile
        </h2>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.5rem" }}>
          Update your display name. Email changes require contacting support.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <div style={{ display: "grid", gap: "1rem" }}>
            {/* Name field */}
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>
                Display Name
              </span>
              <input
                id="profile-name"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Your display name"
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "#f0f2ff",
                  padding: "0.75rem 1rem",
                  fontSize: "0.9rem",
                  outline: "none",
                  fontFamily: "inherit",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "rgba(252,6,148,0.5)";
                  e.target.style.boxShadow = "0 0 0 3px rgba(252,6,148,0.12)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(255,255,255,0.1)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </label>

            {/* Email (read-only) */}
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.4rem" }}>
                Email Address
                <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", fontWeight: 500, color: "rgba(240,242,255,0.3)" }}>
                  (read-only)
                </span>
              </span>
              <input
                type="email"
                value={email}
                readOnly
                disabled
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  color: "rgba(240,242,255,0.35)",
                  padding: "0.75rem 1rem",
                  fontSize: "0.9rem",
                  outline: "none",
                  fontFamily: "inherit",
                  cursor: "not-allowed",
                }}
              />
            </label>

            {/* Feedback */}
            {error && (
              <p style={{ fontSize: "0.82rem", color: "#f87171", display: "flex", alignItems: "center", gap: "0.4rem" }} role="alert">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </p>
            )}
            {notice && (
              <p style={{ fontSize: "0.82rem", color: "#34d399" }}>
                ✓ {notice}
              </p>
            )}

            {/* Save */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                id="profile-save-btn"
                type="submit"
                disabled={saving || draft.trim() === name}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.65rem 1.4rem",
                  borderRadius: 10, border: "none",
                  cursor: saving || draft.trim() === name ? "not-allowed" : "pointer",
                  fontSize: "0.875rem", fontWeight: 700,
                  background: "linear-gradient(135deg,#fc0694,#d4057d)",
                  color: "#fff",
                  opacity: saving || draft.trim() === name ? 0.6 : 1,
                  boxShadow: saving || draft.trim() === name ? "none" : "0 4px 16px rgba(252,6,148,0.35)",
                  fontFamily: "inherit",
                  transition: "opacity 0.15s, box-shadow 0.15s",
                }}
              >
                {saving ? (
                  <span style={{
                    width: 13, height: 13, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    animation: "spin 0.65s linear infinite",
                  }} />
                ) : null}
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
