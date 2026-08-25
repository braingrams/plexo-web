"use client";

import { FormEvent, useState } from "react";
import { Card } from "../_components/Card";
import { PageHeader } from "../_components/PageHeader";
import { useLayoutMode, type LayoutMode } from "../layout-mode-context";

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
  PRO: { bg: "var(--brand-subtle)", color: "var(--brand)", border: "rgba(139,92,246,0.25)" },
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

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
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
    <>
      <PageHeader
        eyebrow="Account"
        title="Your Profile"
        subtitle="Manage your personal information and account preferences."
      />

      {/* Avatar + info card */}
      <Card
        style={{
          marginBottom: "1.5rem",
          display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap",
        }}
      >
        {/* Avatar */}
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
          display: "grid", placeItems: "center",
          fontSize: "1.35rem", fontWeight: 800, color: "#fff",
          fontFamily: "var(--font-heading), sans-serif",
          boxShadow: "0 0 28px rgba(139,92,246,0.4)",
          flexShrink: 0,
          letterSpacing: "-0.02em",
        }}>
          {initials || <IconUser />}
        </div>

        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
            <h2 style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "1.15rem", fontWeight: 700, color: "#f0f2ff",
              margin: 0, wordBreak: "break-word",
            }}>
              {name || "Unnamed User"}
            </h2>
            {/* Plan badge */}
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "0.25rem 0.7rem",
              borderRadius: 999,
              fontSize: "0.68rem", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              background: planStyle.bg,
              color: planStyle.color,
              border: `1px solid ${planStyle.border}`,
              flexShrink: 0,
            }}>
              {subscriptionPlan}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem",
              fontSize: "0.8rem", color: "rgba(240,242,255,0.55)", wordBreak: "break-all",
            }}>
              <IconMail />
              {email}
            </span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem",
              fontSize: "0.78rem", color: "rgba(240,242,255,0.35)",
            }}>
              <IconCalendar />
              Member since {formatDate(memberSince)}
            </span>
          </div>
        </div>
      </Card>

      {/* Edit form */}
      <Card style={{ marginBottom: "1.5rem" }}>
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
                  e.target.style.borderColor = "rgba(139,92,246,0.5)";
                  e.target.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.12)";
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
              <p style={{ fontSize: "0.82rem", color: "#34d399", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <IconCheck /> {notice}
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
                  background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                  color: "#fff",
                  opacity: saving || draft.trim() === name ? 0.6 : 1,
                  boxShadow: saving || draft.trim() === name ? "none" : "0 4px 16px var(--brand-glow)",
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
      </Card>

      {/* Dashboard layout preference */}
      <LayoutModeSection />
    </>
  );
}

function LayoutModeSection() {
  const { mode, setMode, saving, error } = useLayoutMode();

  const options: Array<{ value: LayoutMode; title: string; desc: string }> = [
    { value: "CLASSIC", title: "Classic", desc: "Vertical sidebar navigation — the current Plexo dashboard." },
    { value: "MODERN", title: "Modern 2026", desc: "Floating top navigation with spacious bento-style cards." },
  ];

  return (
    <Card style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.3rem" }}>
        Dashboard Layout
      </h2>
      <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.35)", marginBottom: "1.5rem" }}>
        Choose how your dashboard looks. Your choice is saved to your account and applied the next time you sign in.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} className="layout-mode-grid">
        {options.map((opt) => {
          const selected = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => void setMode(opt.value)}
              disabled={saving}
              style={{
                textAlign: "left",
                background: selected ? "var(--brand-subtle)" : "rgba(255,255,255,0.02)",
                border: selected ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                padding: "1.1rem",
                cursor: saving ? "not-allowed" : "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                fontFamily: "inherit",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <LayoutPreview variant={opt.value} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                <div>
                  <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff" }}>{opt.title}</p>
                  <p style={{ fontSize: "0.76rem", color: "rgba(240,242,255,0.4)", marginTop: "0.15rem" }}>{opt.desc}</p>
                </div>
                {selected && (
                  <span
                    style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "var(--brand)", color: "#fff",
                      display: "grid", placeItems: "center", flexShrink: 0,
                      fontSize: "0.7rem", fontWeight: 700,
                    }}
                  >
                    <IconCheck />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <p style={{ fontSize: "0.82rem", color: "#f87171", marginTop: "1rem" }} role="alert">
          {error}
        </p>
      )}

      <style jsx>{`
        @media (max-width: 640px) {
          .layout-mode-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </Card>
  );
}

function LayoutPreview({ variant }: { variant: LayoutMode }) {
  const boxStyle = {
    height: 80,
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.05)",
    padding: 8,
  } as const;

  if (variant === "MODERN") {
    return (
      <div style={{ ...boxStyle, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ height: 10, borderRadius: 999, background: "linear-gradient(90deg, var(--brand), var(--brand-deep))", width: "60%" }} />
        <div style={{ flex: 1, display: "flex", gap: 5 }}>
          <div style={{ flex: 1, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ flex: 1, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...boxStyle, display: "flex", gap: 6 }}>
      <div style={{ width: 18, borderRadius: 6, background: "rgba(255,255,255,0.08)" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ height: 10, borderRadius: 4, background: "linear-gradient(90deg, var(--brand), var(--brand-deep))", width: "50%" }} />
        <div style={{ flex: 1, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
      </div>
    </div>
  );
}
