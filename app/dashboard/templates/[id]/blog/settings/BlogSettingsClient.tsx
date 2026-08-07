"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FONT_PRESET_OPTIONS } from "@/lib/pub/blogTheme";
import { PageContainer } from "../../../../_components/PageContainer";

type Category = { id: string; name: string; slug: string };
type Tag = { id: string; name: string; slug: string };
type Author = { id: string; name: string };

const FIELD_LABEL: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" };
const FIELD_INPUT: React.CSSProperties = { width: "100%", padding: "0.55rem 0.7rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontSize: "0.85rem", fontFamily: "inherit" };
const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.25rem", background: "rgba(255,255,255,0.02)" };

function TaxonomyList({
  templateId,
  kind,
  items,
  onDeleted,
}: {
  templateId: string;
  kind: "categories" | "tags" | "authors";
  items: { id: string; name: string }[];
  onDeleted: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Remove this? Posts keep their content, they just lose this label.")) return;
    setBusyId(id);
    const res = await fetch(`/api/blog/${templateId}/${kind}/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) onDeleted(id);
  }

  if (items.length === 0) {
    return <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.35)" }}>None yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {items.map((item) => (
        <span
          key={item.id}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.7rem", borderRadius: 999,
            background: "rgba(255,255,255,0.06)", color: "rgba(240,242,255,0.8)", fontSize: "0.78rem",
          }}
        >
          {item.name}
          <button
            type="button"
            onClick={() => handleDelete(item.id)}
            disabled={busyId === item.id}
            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontWeight: 700, fontSize: "0.85rem" }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

type LayoutInfo = { templateId: string; ready: boolean } | null;

function LayoutDesignRow({
  templateId,
  kind,
  label,
  layout,
}: {
  templateId: string;
  kind: "post" | "listing";
  label: string;
  layout: LayoutInfo;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDesign() {
    setBusy(true);
    try {
      const res = await fetch(`/api/blog/${templateId}/layout/${kind}`, { method: "POST" });
      if (res.ok) {
        const { layoutTemplateId } = await res.json();
        router.push(`/dashboard/templates/${layoutTemplateId}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Switch back to the default theme? Your custom layout design stays saved and can be re-attached later.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/blog/${templateId}/layout/${kind}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.8rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div>
        <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.2rem" }}>{label}</p>
        <p style={{ fontSize: "0.75rem", color: layout ? (layout.ready ? "#4ade80" : "#f59e0b") : "rgba(240,242,255,0.4)" }}>
          {!layout ? "Using the default theme" : layout.ready ? "Custom layout live" : "Draft — add the required block to go live"}
        </p>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {layout ? (
          <>
            <Link
              href={`/dashboard/templates/${layout.templateId}`}
              style={{ padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.8)", fontSize: "0.78rem", fontWeight: 600, textDecoration: "none" }}
            >
              Edit
            </Link>
            <button type="button" onClick={handleRemove} disabled={busy} style={{ padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
              Remove
            </button>
          </>
        ) : (
          <button type="button" onClick={handleDesign} disabled={busy} style={{ padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
            {busy ? "Creating…" : "Design custom layout"}
          </button>
        )}
      </div>
    </div>
  );
}

export function BlogSettingsClient({
  templateId,
  initialSite,
  postLayout,
  listingLayout,
  categories: initialCategories,
  tags: initialTags,
  authors: initialAuthors,
}: {
  templateId: string;
  initialSite: {
    enabled: boolean;
    title: string;
    description: string;
    postsPerPage: number;
    showOnHomepage: boolean;
    accentColor: string;
    fontPreset: string;
    logoUrl: string;
    headerImageUrl: string;
    commentsEnabled: boolean;
  };
  postLayout: LayoutInfo;
  listingLayout: LayoutInfo;
  categories: Category[];
  tags: Tag[];
  authors: Author[];
}) {
  const [site, setSite] = useState(initialSite);
  const [categories, setCategories] = useState(initialCategories);
  const [tags, setTags] = useState(initialTags);
  const [authors, setAuthors] = useState(initialAuthors);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);

  async function uploadAndSet(file: File, field: "logoUrl" | "headerImageUrl", setUploading: (v: boolean) => void) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/blog/${templateId}/upload-image`, { method: "POST", body: form });
      if (res.ok) {
        const { url } = await res.json();
        setSite((prev) => ({ ...prev, [field]: url }));
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/blog/${templateId}/site`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(site),
      });
      if (res.ok) setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "1.5rem" }}>Blog Settings</h1>

      <div style={PANEL}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem", fontSize: "0.9rem", fontWeight: 600, color: "#f0f2ff" }}>
          <input type="checkbox" checked={site.enabled} onChange={(e) => setSite({ ...site, enabled: e.target.checked })} />
          Blog is live at /blog
        </label>

        <label style={FIELD_LABEL}>Blog title</label>
        <input value={site.title} onChange={(e) => setSite({ ...site, title: e.target.value })} style={{ ...FIELD_INPUT, marginBottom: "0.9rem" }} />

        <label style={FIELD_LABEL}>Description</label>
        <textarea
          value={site.description}
          onChange={(e) => setSite({ ...site, description: e.target.value })}
          rows={2}
          style={{ ...FIELD_INPUT, marginBottom: "0.9rem", resize: "vertical" }}
        />

        <label style={FIELD_LABEL}>Posts per page</label>
        <input
          type="number"
          min={1}
          max={50}
          value={site.postsPerPage}
          onChange={(e) => setSite({ ...site, postsPerPage: Number(e.target.value) })}
          style={{ ...FIELD_INPUT, marginBottom: "0.9rem", maxWidth: 120 }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem", fontSize: "0.85rem", color: "rgba(240,242,255,0.75)" }}>
          <input type="checkbox" checked={site.showOnHomepage} onChange={(e) => setSite({ ...site, showOnHomepage: e.target.checked })} />
          Use the blog as this site&apos;s homepage
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.1rem", fontSize: "0.85rem", color: "rgba(240,242,255,0.75)" }}>
          <input type="checkbox" checked={site.commentsEnabled} onChange={(e) => setSite({ ...site, commentsEnabled: e.target.checked })} />
          Allow comments on posts
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "0.6rem 1.2rem", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, background: "var(--brand)", color: "#fff" }}
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
        {savedAt && <span style={{ marginLeft: "0.8rem", fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>Saved {savedAt.toLocaleTimeString()}</span>}
      </div>

      <div style={PANEL}>
        <label style={FIELD_LABEL}>Appearance</label>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", marginTop: "-0.2rem", marginBottom: "1rem" }}>
          Plexo's blog uses its own built-in layout rather than your old WordPress theme (themes aren't portable between
          platforms) — these let you approximate your old brand.
        </p>

        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <div>
            <label style={FIELD_LABEL}>Accent color</label>
            <input
              type="color"
              value={site.accentColor || "#6d28d9"}
              onChange={(e) => setSite({ ...site, accentColor: e.target.value })}
              style={{ width: 56, height: 36, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", cursor: "pointer" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={FIELD_LABEL}>Font</label>
            <select value={site.fontPreset} onChange={(e) => setSite({ ...site, fontPreset: e.target.value })} style={FIELD_INPUT}>
              {FONT_PRESET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={FIELD_LABEL}>Logo</label>
            {site.logoUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <img src={site.logoUrl} alt="" style={{ maxHeight: 40, borderRadius: 6 }} />
                <button type="button" onClick={() => setSite({ ...site, logoUrl: "" })} style={{ fontSize: "0.75rem", color: "#f87171", background: "none", border: "none", cursor: "pointer" }}>
                  Remove
                </button>
              </div>
            ) : (
              <label style={{ display: "inline-block", padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px dashed rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "0.78rem", color: "rgba(240,242,255,0.5)" }}>
                {uploadingLogo ? "Uploading…" : "Upload logo"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSet(f, "logoUrl", setUploadingLogo); }} />
              </label>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={FIELD_LABEL}>Header banner image</label>
            {site.headerImageUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <img src={site.headerImageUrl} alt="" style={{ maxHeight: 40, borderRadius: 6 }} />
                <button type="button" onClick={() => setSite({ ...site, headerImageUrl: "" })} style={{ fontSize: "0.75rem", color: "#f87171", background: "none", border: "none", cursor: "pointer" }}>
                  Remove
                </button>
              </div>
            ) : (
              <label style={{ display: "inline-block", padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px dashed rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "0.78rem", color: "rgba(240,242,255,0.5)" }}>
                {uploadingHeader ? "Uploading…" : "Upload banner"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndSet(f, "headerImageUrl", setUploadingHeader); }} />
              </label>
            )}
          </div>
        </div>
      </div>

      <div style={PANEL}>
        <label style={FIELD_LABEL}>Custom Layouts</label>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", marginTop: "-0.2rem", marginBottom: "0.5rem" }}>
          Design your own drag-and-drop layout with Plexo's builder — drop in the &quot;Blog&quot; blocks (Post Title, Post
          Content, Featured Image, etc.) wherever you want your content to appear, and your real posts flow into them
          automatically. Leave unset to use the built-in theme.
        </p>
        <LayoutDesignRow templateId={templateId} kind="post" label="Single post page" layout={postLayout} />
        <LayoutDesignRow templateId={templateId} kind="listing" label="Blog listing page" layout={listingLayout} />
      </div>

      <div style={PANEL}>
        <label style={FIELD_LABEL}>Categories</label>
        <TaxonomyList templateId={templateId} kind="categories" items={categories} onDeleted={(id) => setCategories((prev) => prev.filter((c) => c.id !== id))} />
      </div>

      <div style={PANEL}>
        <label style={FIELD_LABEL}>Tags</label>
        <TaxonomyList templateId={templateId} kind="tags" items={tags} onDeleted={(id) => setTags((prev) => prev.filter((t) => t.id !== id))} />
      </div>

      <div style={PANEL}>
        <label style={FIELD_LABEL}>Authors</label>
        <TaxonomyList templateId={templateId} kind="authors" items={authors} onDeleted={(id) => setAuthors((prev) => prev.filter((a) => a.id !== id))} />
      </div>
    </PageContainer>
  );
}
