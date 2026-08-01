"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/app/dashboard/_components/Card";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  color: "#f0f2ff",
  padding: "0.75rem 1rem",
  fontSize: "0.9rem",
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#c5cbe8",
  marginBottom: "0.4rem",
};

type Props = {
  organizationId: string;
  canManage: boolean;
  whiteLabelEnabled: boolean;
  initialName: string;
  initialLogo: string | null;
  initialBrandColor: string | null;
};

export function BrandingForm({
  organizationId,
  canManage,
  whiteLabelEnabled,
  initialName,
  initialLogo,
  initialBrandColor,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [logo, setLogo] = useState(initialLogo ?? "");
  const [brandColor, setBrandColor] = useState(initialBrandColor ?? "#8b5cf6");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const disabled = !canManage || !whiteLabelEnabled;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, logo: logo.trim() || null, brandColor: brandColor.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Couldn't save branding.");
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save branding.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      {!whiteLabelEnabled && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem 1.25rem",
            borderRadius: 10,
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.25)",
            color: "#e2e8f0",
            fontSize: "0.85rem",
            lineHeight: 1.5,
          }}
        >
          Custom branding is a Pro/Ultra feature. Upgrade the organization owner's plan to
          replace the Plexo name, logo, and color shown here.
        </div>
      )}
      {whiteLabelEnabled && !canManage && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem 1.25rem",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(240,242,255,0.6)",
            fontSize: "0.85rem",
          }}
        >
          Only the organization owner can change branding.
        </div>
      )}

      <form onSubmit={handleSave} style={{ display: "grid", gap: "1.25rem", opacity: disabled ? 0.6 : 1 }}>
        <label style={{ display: "block" }}>
          <span style={labelStyle}>Organization / Brand Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            placeholder="Your Company"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={labelStyle}>Logo URL</span>
          <input
            type="url"
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            disabled={disabled}
            placeholder="https://yourcompany.com/logo.png"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={labelStyle}>Accent Color</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#8b5cf6"}
              onChange={(e) => setBrandColor(e.target.value)}
              disabled={disabled}
              style={{ width: 44, height: 44, padding: 0, border: "none", borderRadius: 8, background: "none" }}
            />
            <input
              type="text"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              disabled={disabled}
              placeholder="#4f46e5"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        </label>

        {logo && (
          <div>
            <span style={labelStyle}>Preview</span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.75rem 1rem",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
              }}
            >
              <img
                src={logo}
                alt={name}
                style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover" }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              <span style={{ fontWeight: 700, color: "#f0f2ff" }}>{name || "Your Brand"}</span>
            </div>
          </div>
        )}

        {error && <p style={{ color: "#f87171", fontSize: "0.85rem", margin: 0 }}>{error}</p>}
        {saved && !error && <p style={{ color: "#34d399", fontSize: "0.85rem", margin: 0 }}>Saved.</p>}

        <div>
          <button
            type="submit"
            disabled={disabled || saving}
            style={{
              background: disabled ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, var(--brand), var(--brand-deep))",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontWeight: 700,
              cursor: disabled || saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save branding"}
          </button>
        </div>
      </form>
    </Card>
  );
}
