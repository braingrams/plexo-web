"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "../../../_components/Card";

const CARD_TITLE: React.CSSProperties = { fontSize: "0.95rem", fontWeight: 700, color: "var(--plx-text, #f0f2ff)", margin: 0 };
const FIELD_LABEL: React.CSSProperties = { fontSize: "0.82rem", color: "var(--plx-muted, rgba(240,242,255,0.5))", fontWeight: 600 };
const FIELD_HINT: React.CSSProperties = { fontSize: "0.74rem", color: "var(--plx-faint, rgba(240,242,255,0.35))", margin: "0.35rem 0 0" };

// Matches GeneralSettingsClient.tsx's own `inputStyle` (Commerce settings) exactly, plus
// the `.site-appearance-field:focus` rule below — outline:none alone (as this codebase's
// other settings inputs already do) left every field showing the browser's raw default
// blue focus ring against this dark theme, jarring enough on its own to be the main
// complaint about this panel's polish.
const FIELD_STYLE: React.CSSProperties = {
  width: "100%", background: "color-mix(in srgb, var(--plx-text, #fff) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)",
  borderRadius: 9, color: "var(--plx-text, #f0f2ff)", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

type SiteMeta = { htmlTitle: string; favicon: string; metaDescription: string; ogImageUrl: string };

/** Uploads a file to the platform's generic media store and returns its public URL —
 * same endpoint the media/image pickers elsewhere in the dashboard use, so a favicon
 * upload here works exactly like uploading any other image. */
async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/v1/media/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload failed.");
  return data.url as string;
}

function ImageField({
  label, hint, value, onChange, uploading, onUpload,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span style={{ ...FIELD_LABEL, display: "block", marginBottom: "0.5rem" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div
          style={{
            flexShrink: 0, width: 44, height: 44, borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)", background: "color-mix(in srgb, var(--plx-text, #fff) 3%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: "0.65rem", color: "var(--plx-faint, rgba(240,242,255,0.25))" }}>None</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste an image URL, or upload one"
            className="site-appearance-field"
            style={FIELD_STYLE}
          />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            flexShrink: 0, padding: "0.6rem 0.9rem", borderRadius: 9, fontSize: "0.8rem", fontWeight: 700,
            border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 12%, transparent)", background: "color-mix(in srgb, var(--plx-text, #fff) 4%, transparent)", color: "var(--plx-text, rgba(240,242,255,0.85))",
            cursor: uploading ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: uploading ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
      <p style={FIELD_HINT}>{hint}</p>
    </div>
  );
}

export function SiteAppearancePanel({ templateId }: { templateId: string }) {
  const [meta, setMeta] = useState<SiteMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [uploadingOg, setUploadingOg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/templates/${templateId}/site-meta`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load.");
        setMeta(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, [templateId]);

  async function save() {
    if (!meta) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/site-meta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 style={{ ...CARD_TITLE, marginBottom: "0.3rem" }}>Site Appearance</h2>
      <p style={{ fontSize: "0.8rem", color: "var(--plx-muted, rgba(240,242,255,0.45))", margin: "0 0 1.25rem" }}>
        The favicon, browser-tab title, and social share preview for your home page.
      </p>

      {loading ? (
        <p style={{ fontSize: "0.82rem", color: "var(--plx-muted, rgba(240,242,255,0.4))" }}>Loading…</p>
      ) : !meta ? (
        <p style={{ fontSize: "0.82rem", color: "var(--plx-danger, #f87171)" }}>{error ?? "Couldn't load site appearance."}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
          <div className="site-appearance-row" style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: "1.4rem", alignItems: "start" }}>
            <ImageField
              label="Favicon"
              hint="Shown in the browser tab. A square PNG works best (at least 64×64px)."
              value={meta.favicon}
              onChange={(v) => setMeta({ ...meta, favicon: v })}
              uploading={uploadingFavicon}
              onUpload={async (file) => {
                setUploadingFavicon(true);
                setError(null);
                try {
                  const url = await uploadImage(file);
                  setMeta((prev) => (prev ? { ...prev, favicon: url } : prev));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed.");
                } finally {
                  setUploadingFavicon(false);
                }
              }}
            />

            <div>
              <span style={{ ...FIELD_LABEL, display: "block", marginBottom: "0.5rem" }}>Browser tab title</span>
              <input
                type="text"
                value={meta.htmlTitle}
                onChange={(e) => setMeta({ ...meta, htmlTitle: e.target.value })}
                placeholder="Your site's name"
                maxLength={200}
                className="site-appearance-field"
                style={FIELD_STYLE}
              />
              <p style={FIELD_HINT}>Shown in the browser tab and search engine results.</p>
            </div>
          </div>

          <div>
            <span style={{ ...FIELD_LABEL, display: "block", marginBottom: "0.5rem" }}>Meta description</span>
            <textarea
              value={meta.metaDescription}
              onChange={(e) => setMeta({ ...meta, metaDescription: e.target.value })}
              placeholder="A short summary shown in search results and link previews"
              maxLength={300}
              rows={4}
              className="site-appearance-field"
              style={{ ...FIELD_STYLE, resize: "vertical", lineHeight: 1.5, minHeight: "6rem" }}
            />
          </div>

          <ImageField
            label="Social share image"
            hint="Shown when this page is shared on social media or messaging apps."
            value={meta.ogImageUrl}
            onChange={(v) => setMeta({ ...meta, ogImageUrl: v })}
            uploading={uploadingOg}
            onUpload={async (file) => {
              setUploadingOg(true);
              setError(null);
              try {
                const url = await uploadImage(file);
                setMeta((prev) => (prev ? { ...prev, ogImageUrl: url } : prev));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed.");
              } finally {
                setUploadingOg(false);
              }
            }}
          />

          {error && <p style={{ fontSize: "0.78rem", color: "var(--plx-danger, #f87171)", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", paddingTop: "0.25rem", borderTop: "1px solid color-mix(in srgb, var(--plx-text, #fff) 6%, transparent)", marginTop: "0.1rem" }}>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                padding: "0.65rem 1.4rem", borderRadius: 9, fontSize: "0.85rem", fontWeight: 700, border: "none",
                background: "var(--plx-brand, linear-gradient(135deg,var(--brand),var(--brand-deep)))", color: "var(--plx-on-brand, #fff)",
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", marginTop: "0.85rem",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span style={{ fontSize: "0.8rem", color: "var(--plx-success, #4ade80)", fontWeight: 600, marginTop: "0.85rem" }}>Saved ✓</span>}
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.site-appearance-field:focus) {
          border-color: color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 50%, transparent) !important;
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 15%, transparent);
        }
        :global(.site-appearance-field::placeholder) {
          color: var(--plx-faint, rgba(240, 242, 255, 0.3));
        }
        @media (max-width: 620px) {
          :global(.site-appearance-row) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </Card>
  );
}
