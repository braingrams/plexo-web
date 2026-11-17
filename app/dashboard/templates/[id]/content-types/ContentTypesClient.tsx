"use client";

import { useState } from "react";
import Link from "next/link";
import { slugify } from "@/lib/slugUtils";
import { contentSnippet } from "@/lib/customContent/embed";
import { CONTENT_PRESETS, type ContentPresetId } from "@/lib/customContent/presets-meta";
import { PageContainer } from "../../../_components/PageContainer";
import { SiteBackLink } from "../../../_components/EditorTheme";
import { Card } from "../../../_components/Card";

export type CustomContentFieldType = "text" | "textarea" | "richtext" | "number" | "boolean" | "date" | "image_url" | "url" | "video" | "datetime";

export type ContentTypeField = {
  id: string;
  name: string;
  key: string;
  type: CustomContentFieldType;
  required: boolean;
};

export type ContentTypeSummary = {
  id: string;
  name: string;
  slug: string;
  fields: ContentTypeField[];
  entryCount: number;
  createdAt: string;
};

const FIELD_TYPE_OPTIONS: { value: CustomContentFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Textarea" },
  { value: "richtext", label: "Rich text (plain/HTML)" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "image_url", label: "Image (upload)" },
  { value: "video", label: "Video (YouTube, Vimeo or link)" },
  { value: "datetime", label: "Date & time" },
  { value: "url", label: "Link" },
];

type FieldRow = {
  rowId: string;
  name: string;
  key: string;
  keyEdited: boolean;
  type: CustomContentFieldType;
  required: boolean;
};

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `row-${rowIdCounter}`;
}

function blankRow(): FieldRow {
  return { rowId: nextRowId(), name: "", key: "", keyEdited: false, type: "text", required: false };
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--ed-w-040)", border: "1px solid var(--ed-w-100)",
  borderRadius: 9, color: "var(--ed-text)", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--ed-t-800)", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </label>
  );
}

function IconArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export function ContentTypesClient({
  templateId,
  templateName,
  initialContentTypes,
}: {
  templateId: string;
  templateName: string;
  initialContentTypes: ContentTypeSummary[];
}) {
  const [contentTypes, setContentTypes] = useState(initialContentTypes);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<FieldRow[]>([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/v1/templates/${templateId}/content-types`;
  const [adding, setAdding] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function addPreset(preset: ContentPresetId) {
    setAdding(preset);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/presets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Please try again.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
      setAdding(null);
    }
  }

  async function copySnippet(ct: ContentTypeSummary) {
    try {
      await navigator.clipboard.writeText(contentSnippet(ct.slug));
      setCopiedId(ct.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt("Copy this and paste it into your page:", contentSnippet(ct.slug));
    }
  }

  function openCreate() {
    setEditingId(null);
    setName("");
    setRows([blankRow()]);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(ct: ContentTypeSummary) {
    setEditingId(ct.id);
    setName(ct.name);
    setRows(
      ct.fields.length > 0
        ? ct.fields.map((f) => ({ rowId: nextRowId(), name: f.name, key: f.key, keyEdited: true, type: f.type, required: f.required }))
        : [blankRow()],
    );
    setError(null);
    setModalOpen(true);
  }

  function updateRow(rowId: string, patch: Partial<FieldRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const next = { ...r, ...patch };
        if (patch.name !== undefined && !r.keyEdited) {
          next.key = slugify(patch.name);
        }
        return next;
      }),
    );
  }

  function setRowKey(rowId: string, key: string) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, key: slugify(key), keyEdited: true } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow()]);
  }

  function removeRow(rowId: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rowId !== rowId) : prev));
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Enter a name for this content type.");
      return;
    }
    const cleanedFields = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), key: r.key || slugify(r.name), type: r.type, required: r.required }));
    if (cleanedFields.length === 0) {
      setError("Add at least one field.");
      return;
    }
    const keys = new Set<string>();
    for (const f of cleanedFields) {
      if (keys.has(f.key)) {
        setError(`Duplicate field key "${f.key}" — give each field a unique key.`);
        return;
      }
      keys.add(f.key);
    }

    setSaving(true);
    try {
      const url = editingId ? `${apiBase}/${editingId}` : apiBase;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), fields: cleanedFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save content type.");

      if (editingId) {
        setContentTypes((prev) =>
          prev.map((ct) =>
            ct.id === editingId
              ? { ...ct, name: data.contentType.name, slug: data.contentType.slug, fields: data.contentType.fields }
              : ct,
          ),
        );
      } else {
        setContentTypes((prev) => [
          {
            id: data.contentType.id,
            name: data.contentType.name,
            slug: data.contentType.slug,
            fields: data.contentType.fields,
            entryCount: 0,
            createdAt: data.contentType.createdAt,
          },
          ...prev,
        ]);
      }
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save content type.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ct: ContentTypeSummary) {
    if (!window.confirm(`Delete "${ct.name}"? This also deletes all ${ct.entryCount} of its entries. This can't be undone.`)) return;
    const res = await fetch(`${apiBase}/${ct.id}`, { method: "DELETE" });
    if (res.ok) {
      setContentTypes((prev) => prev.filter((c) => c.id !== ct.id));
    }
  }

  return (
    <PageContainer>
      <SiteBackLink
        siteId={templateId}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--ed-t-500)", textDecoration: "none", marginBottom: "1.5rem" }}
      >
        <IconArrowLeft /> {templateName}
      </SiteBackLink>

      <div style={{ marginBottom: "2rem" }}>
        <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ed-accent-text)", marginBottom: "0.35rem" }}>
          {templateName}
        </p>
        <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "var(--ed-text)", letterSpacing: "-0.02em" }}>
          Content Types
        </h1>
        <p style={{ fontSize: "0.85rem", color: "var(--ed-t-450)", marginTop: "0.4rem" }}>
          Post videos, stories, events and more. Add one below, fill it in, and show it on any page.
        </p>
      </div>

      <Card style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
        <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ed-text)", marginBottom: "0.75rem" }}>Quick start</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          {(Object.keys(CONTENT_PRESETS) as ContentPresetId[]).map((id) => {
            const done = contentTypes.some((c) => c.slug === CONTENT_PRESETS[id].slug);
            return (
              <button
                key={id} type="button" disabled={done || adding !== null} onClick={() => void addPreset(id)}
                style={{ textAlign: "left", flex: "1 1 200px", padding: "0.8rem 1rem", borderRadius: 12, border: "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", cursor: done ? "default" : "pointer", opacity: done ? 0.5 : 1, fontFamily: "inherit" }}
              >
                <span style={{ display: "block", fontWeight: 700, fontSize: "0.85rem" }}>{done ? "✓ " : "+ "}{CONTENT_PRESETS[id].name}</span>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--ed-t-500)", marginTop: 2 }}>{CONTENT_PRESETS[id].blurb}</span>
              </button>
            );
          })}
        </div>
        {error && !modalOpen && <p style={{ fontSize: "0.78rem", color: "var(--ed-danger)", marginTop: "0.6rem" }}>{error}</p>}
      </Card>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "1.5rem" }}>
        <button
          type="button" onClick={openCreate}
          style={{ padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "var(--ed-cta)", color: "var(--ed-on-brand)" }}
        >
          + New content type
        </button>
      </div>

      {contentTypes.length === 0 ? (
        <Card style={{ padding: "3rem 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--ed-t-700)" }}>No content types yet</p>
          <p style={{ fontSize: "0.8rem", color: "var(--ed-t-400)", marginTop: "0.3rem" }}>
            Create one to start defining structured content for this site — testimonials, team members, FAQs, anything with a repeatable shape.
          </p>
        </Card>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--ed-w-080)", borderRadius: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ color: "var(--ed-t-400)", textAlign: "left", background: "var(--ed-w-020)" }}>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Name</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Slug</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Fields</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Entries</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {contentTypes.map((ct) => (
                <tr key={ct.id} style={{ borderTop: "1px solid var(--ed-w-060)", color: "var(--ed-text)" }}>
                  <td style={{ padding: "0.7rem 1rem", fontWeight: 700 }}>{ct.name}</td>
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace", color: "var(--ed-t-550)" }}>{ct.slug}</td>
                  <td style={{ padding: "0.7rem 1rem", color: "var(--ed-t-550)" }}>{ct.fields.length}</td>
                  <td style={{ padding: "0.7rem 1rem", color: "var(--ed-t-550)" }}>{ct.entryCount}</td>
                  <td style={{ padding: "0.7rem 1rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                    <Link href={`/dashboard/templates/${templateId}/content-types/${ct.id}/entries`} style={{ color: "var(--ed-accent-text)", fontSize: "0.78rem", fontWeight: 600, textDecoration: "none" }}>
                      Manage entries
                    </Link>
                    <button type="button" onClick={() => void copySnippet(ct)} title="Paste this into an HTML block, a raw HTML page or a React project to show these on a page" style={{ background: "none", border: "none", color: "var(--ed-t-600)", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      {copiedId === ct.id ? "Copied!" : "Copy page code"}
                    </button>
                    <button type="button" onClick={() => openEdit(ct)} style={{ background: "none", border: "none", color: "var(--ed-t-600)", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void handleDelete(ct)} style={{ background: "none", border: "none", color: "var(--ed-danger)", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "var(--plx-overlay, rgba(0,0,0,0.7))", padding: "1rem", overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{ width: "min(100%,620px)", maxHeight: "90vh", overflowY: "auto", background: "var(--ed-bg)", border: "1px solid var(--ed-w-120)", borderRadius: 20, padding: "1.75rem" }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "var(--ed-text)", marginBottom: "1.25rem" }}>
              {editingId ? "Edit content type" : "New content type"}
            </h2>

            <div style={{ display: "grid", gap: "1.25rem" }}>
              <FieldLabel label="Name">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Testimonial" style={inputStyle} />
              </FieldLabel>

              <div>
                <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--ed-t-800)", marginBottom: "0.5rem" }}>Fields</span>
                <div style={{ display: "grid", gap: "0.65rem" }}>
                  {rows.map((row) => (
                    <div
                      key={row.rowId}
                      style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1.1fr auto auto", gap: "0.5rem", alignItems: "center", padding: "0.65rem", borderRadius: 10, background: "var(--ed-w-020)", border: "1px solid var(--ed-w-060)" }}
                    >
                      <input
                        type="text" value={row.name} placeholder="Field name" style={inputStyle}
                        onChange={(e) => updateRow(row.rowId, { name: e.target.value })}
                      />
                      <input
                        type="text" value={row.key} placeholder="key" style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
                        onChange={(e) => setRowKey(row.rowId, e.target.value)}
                      />
                      <select
                        value={row.type} style={inputStyle}
                        onChange={(e) => updateRow(row.rowId, { type: e.target.value as CustomContentFieldType })}
                      >
                        {FIELD_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.72rem", color: "var(--ed-t-600)", whiteSpace: "nowrap" }}>
                        <input type="checkbox" checked={row.required} onChange={(e) => updateRow(row.rowId, { required: e.target.checked })} />
                        Required
                      </label>
                      <button
                        type="button" onClick={() => removeRow(row.rowId)} disabled={rows.length === 1}
                        style={{ background: "none", border: "none", color: rows.length === 1 ? "var(--ed-t-200)" : "var(--ed-danger)", cursor: rows.length === 1 ? "not-allowed" : "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.2rem" }}
                        aria-label="Remove field"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button" onClick={addRow}
                  style={{ marginTop: "0.65rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px dashed var(--ed-w-150)", background: "transparent", color: "var(--ed-t-600)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, fontFamily: "inherit" }}
                >
                  + Add field
                </button>
              </div>

              {error && <p style={{ fontSize: "0.82rem", color: "var(--ed-danger)" }}>{error}</p>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid var(--ed-w-100)", background: "transparent", color: "var(--ed-t-650)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600 }}>
                  Cancel
                </button>
                <button
                  type="button" onClick={() => void handleSave()} disabled={saving}
                  style={{ padding: "0.6rem 1.4rem", borderRadius: 9, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700 }}
                >
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create content type"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
