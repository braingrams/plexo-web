"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "../../../_components/Card";

const CARD_TITLE: React.CSSProperties = { fontSize: "1rem", fontWeight: 800, color: "#f0f2ff", margin: 0 };
const LABEL_STYLE: React.CSSProperties = { fontSize: "0.78rem", fontWeight: 600, color: "rgba(240,242,255,0.55)" };
const INPUT_STYLE: React.CSSProperties = {
  width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, fontSize: "0.85rem",
  border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontFamily: "inherit",
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

function FieldWithUpload({
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
        <span style={LABEL_STYLE}>{label}</span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--brand)", background: "none", border: "none", cursor: uploading ? "not-allowed" : "pointer", padding: 0 }}
        >
          {uploading ? "Uploading…" : "Upload image"}
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
      {value ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
          <img src={value} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", border: "1px solid rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
        </div>
      ) : null}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Or paste an image URL" style={INPUT_STYLE} />
      <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", margin: "0.3rem 0 0" }}>{hint}</p>
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
      <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: "0 0 1rem" }}>
        The favicon, browser-tab title, and social share preview for your home page.
      </p>

      {loading ? (
        <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.4)" }}>Loading…</p>
      ) : !meta ? (
        <p style={{ fontSize: "0.82rem", color: "#f87171" }}>{error ?? "Couldn't load site appearance."}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <FieldWithUpload
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
            <span style={{ ...LABEL_STYLE, display: "block", marginBottom: "0.35rem" }}>Browser tab title</span>
            <input
              type="text"
              value={meta.htmlTitle}
              onChange={(e) => setMeta({ ...meta, htmlTitle: e.target.value })}
              placeholder="Your site's name"
              maxLength={200}
              style={INPUT_STYLE}
            />
          </div>

          <div>
            <span style={{ ...LABEL_STYLE, display: "block", marginBottom: "0.35rem" }}>Meta description</span>
            <textarea
              value={meta.metaDescription}
              onChange={(e) => setMeta({ ...meta, metaDescription: e.target.value })}
              placeholder="A short summary shown in search results and link previews"
              maxLength={300}
              rows={3}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          <FieldWithUpload
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

          {error && <p style={{ fontSize: "0.78rem", color: "#f87171", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                padding: "0.55rem 1.1rem", borderRadius: 8, fontSize: "0.82rem", fontWeight: 700,
                border: "1px solid rgba(var(--brand-rgb),0.3)", background: "rgba(var(--brand-rgb),0.12)", color: "var(--brand)",
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span style={{ fontSize: "0.78rem", color: "#4ade80", fontWeight: 600 }}>Saved ✓</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
