"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/app/dashboard/_components/Card";

type BrandDisplayMode = "LOGO_ONLY" | "NAME_ONLY" | "BOTH";

const DISPLAY_MODE_OPTIONS: Array<{ value: BrandDisplayMode; label: string; description: string }> = [
  { value: "BOTH", label: "Logo + Name", description: "Show both together" },
  { value: "LOGO_ONLY", label: "Logo only", description: "Hide the name wherever the logo shows" },
  { value: "NAME_ONLY", label: "Name only", description: "Hide the logo wherever the name shows" },
];

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
  planAllowsWhiteLabel: boolean;
  initialWhiteLabelEnabled: boolean;
  initialName: string;
  initialLogo: string | null;
  initialBrandColor: string | null;
  initialBrandDisplayMode: BrandDisplayMode;
};

export function BrandingForm({
  organizationId,
  canManage,
  planAllowsWhiteLabel,
  initialWhiteLabelEnabled,
  initialName,
  initialLogo,
  initialBrandColor,
  initialBrandDisplayMode,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [logo, setLogo] = useState(initialLogo ?? "");
  const [displayMode, setDisplayMode] = useState<BrandDisplayMode>(initialBrandDisplayMode);
  // A real hex literal, not var(--brand) — this is form DATA (what gets saved / fed to an
  // <input type="color">, which requires a literal #rrggbb value), not a CSS style.
  const [brandColor, setBrandColor] = useState(initialBrandColor ?? "#8b5cf6");
  const [whiteLabelOn, setWhiteLabelOn] = useState(initialWhiteLabelEnabled);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const disabled = !canManage || !planAllowsWhiteLabel;

  // Reuses the same generic image-upload endpoint the blog/media pickers already use
  // (public access, org-scoped, 8MB/JPEG-PNG-GIF-WebP-AVIF-SVG limit) rather than a new
  // upload route just for logos. Replacing an old UPLOADED logo (never a pasted external
  // URL) is handled server-side, in the PATCH below — see that route's own comment.
  async function handleFileSelected(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/v1/media/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Upload failed.");
      setLogo(data.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          logo: logo.trim() || null,
          brandColor: brandColor.trim() || null,
          brandDisplayMode: displayMode,
          whiteLabelEnabled: whiteLabelOn,
        }),
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

  const showLogo = logo && displayMode !== "NAME_ONLY";
  const showName = displayMode !== "LOGO_ONLY";

  return (
    <Card>
      {!planAllowsWhiteLabel && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem 1.25rem",
            borderRadius: 10,
            background: "rgba(var(--brand-rgb),0.08)",
            border: "1px solid rgba(var(--brand-rgb),0.25)",
            color: "#e2e8f0",
            fontSize: "0.85rem",
            lineHeight: 1.5,
          }}
        >
          Custom branding is a Pro/Ultra feature. Upgrade the organization owner's plan to
          replace the Plexo name, logo, and color shown here.
        </div>
      )}
      {planAllowsWhiteLabel && !canManage && (
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "1.5rem",
          padding: "1rem 1.25rem",
          borderRadius: 10,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div>
          <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>
            Enable custom branding
          </p>
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", marginTop: "0.25rem", maxWidth: 460 }}>
            Turn this on to replace "Plexo" with your name, logo, and color across the dashboard,
            emails, and published pages. Off by default even on Pro/Ultra.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={whiteLabelOn}
          aria-disabled={disabled}
          id="toggle-white-label-enabled"
          onClick={() => !disabled && setWhiteLabelOn((v) => !v)}
          style={{
            position: "relative",
            width: 44,
            height: 24,
            borderRadius: 999,
            background: whiteLabelOn ? "var(--brand)" : "rgba(255,255,255,0.1)",
            border: whiteLabelOn ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.2s, border-color 0.2s",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: whiteLabelOn ? 22 : 3,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
            }}
          />
        </button>
      </div>

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

        <div>
          <span style={labelStyle}>Logo</span>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <input
              type="url"
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              disabled={disabled}
              placeholder="https://yourcompany.com/logo.png, or upload one"
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml"
              style={{ display: "none" }}
              onChange={(e) => {
                void handleFileSelected(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              style={{
                flexShrink: 0,
                padding: "0 1.1rem",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#f0f2ff",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: disabled || uploading ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
          <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginTop: "0.4rem" }}>
            Paste a link or upload an image — uploading a new one replaces whatever was there before.
          </p>
        </div>

        <div>
          <span style={labelStyle}>Brand Display</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.5rem" }}>
            {DISPLAY_MODE_OPTIONS.map((option) => {
              const active = displayMode === option.value;
              const optionDisabled = disabled || (option.value !== "NAME_ONLY" && !logo);
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={optionDisabled}
                  onClick={() => setDisplayMode(option.value)}
                  style={{
                    padding: "0.65rem 0.75rem",
                    borderRadius: 9,
                    border: active ? "1.5px solid rgba(var(--brand-rgb),0.4)" : "1px solid rgba(255,255,255,0.08)",
                    background: active ? "rgba(var(--brand-rgb),0.1)" : "rgba(255,255,255,0.03)",
                    color: active ? "#c4b5fd" : "rgba(240,242,255,0.55)",
                    cursor: optionDisabled ? "not-allowed" : "pointer",
                    opacity: optionDisabled && !active ? 0.4 : 1,
                    fontFamily: "inherit",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                >
                  <p style={{ fontSize: "0.8rem", fontWeight: active ? 700 : 600, margin: 0 }}>{option.label}</p>
                  <p style={{ fontSize: "0.68rem", color: active ? "rgba(196,181,253,0.7)" : "rgba(240,242,255,0.3)", margin: "0.15rem 0 0" }}>
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
          {!logo && displayMode !== "NAME_ONLY" && (
            <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginTop: "0.4rem" }}>
              Add a logo above to enable the logo-only option.
            </p>
          )}
        </div>

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

        {(logo || name) && (
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
              {showLogo && (
                <img
                  src={logo}
                  alt={name}
                  style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover" }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
              )}
              {showName && <span style={{ fontWeight: 700, color: "#f0f2ff" }}>{name || "Your Brand"}</span>}
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
