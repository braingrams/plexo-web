"use client";

import { useState } from "react";
import { PageHeader } from "../_components/PageHeader";

type Props = {
  initialManageLandingPagePublishing: boolean;
  isUltra: boolean;
};

export function SettingsClient({ initialManageLandingPagePublishing, isUltra }: Props) {
  const [manageLandingPagePublishing, setManageLandingPagePublishing] = useState<boolean>(initialManageLandingPagePublishing);
  const [publishSettingSaving, setPublishSettingSaving] = useState(false);
  const [publishSettingError, setPublishSettingError] = useState<string | null>(null);

  async function toggleManageLandingPagePublishing(): Promise<void> {
    if (!isUltra) return;
    const next = !manageLandingPagePublishing;
    setManageLandingPagePublishing(next);
    setPublishSettingSaving(true);
    setPublishSettingError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manageLandingPagePublishing: next }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Unable to update this setting.");
      }
    } catch (error) {
      setManageLandingPagePublishing(!next);
      setPublishSettingError(error instanceof Error ? error.message : "Unable to update this setting.");
    } finally {
      setPublishSettingSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" subtitle="General publishing behavior for this account." />

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
              Landing Page Publishing
            </h2>
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", maxWidth: 520 }}>
              Let embedded SDK builders publish landing pages directly to your account&apos;s domain limit, with no cap on how many domains they publish.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            {!isUltra && (
              <span style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)", padding: "0.2rem 0.5rem", borderRadius: 5 }}>
                Requires Ultra
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={manageLandingPagePublishing}
              id="toggle-manage-landing-page-publishing"
              disabled={!isUltra || publishSettingSaving}
              onClick={() => void toggleManageLandingPagePublishing()}
              style={{
                position: "relative", width: 44, height: 24, borderRadius: 999,
                background: manageLandingPagePublishing ? "var(--brand)" : "rgba(255,255,255,0.1)",
                border: manageLandingPagePublishing ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                cursor: (isUltra && !publishSettingSaving) ? "pointer" : "not-allowed",
                opacity: isUltra ? 1 : 0.5,
                transition: "background 0.2s, border-color 0.2s", flexShrink: 0,
              }}
            >
              <span style={{ position: "absolute", top: 3, left: manageLandingPagePublishing ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)" }} />
            </button>
          </div>
        </div>

        {!isUltra && (
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "1rem" }}>
            Upgrade to Ultra on the Subscription page to unlock self-managed publishing.
          </p>
        )}
        {publishSettingError && (
          <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>{publishSettingError}</p>
        )}
      </div>
    </>
  );
}
