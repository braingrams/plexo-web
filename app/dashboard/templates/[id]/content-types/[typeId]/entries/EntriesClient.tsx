"use client";

import { useState } from "react";
import Link from "next/link";
import { PageContainer } from "../../../../../_components/PageContainer";
import { Card } from "../../../../../_components/Card";
import type { ContentTypeField } from "../../ContentTypesClient";

export type EntrySummary = {
  id: string;
  data: Record<string, unknown>;
  status: "PUBLISHED" | "DRAFT";
  preview: string;
  updatedAt: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>
        {label}{required && <span style={{ color: "#f87171" }}> *</span>}
      </span>
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

/** Renders one input per field, keyed by the field's own `key` in `values` — text→text
 * input, textarea→textarea, richtext→textarea (plain/simple-HTML text, no WYSIWYG — real
 * scope creep for v1), number→number input, boolean→checkbox, date→date input,
 * image_url→text input with a "paste an image URL" hint, url→text input. */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ContentTypeField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (field.type) {
    case "textarea":
    case "richtext":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === "richtext" ? 6 : 3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: field.type === "richtext" ? "ui-monospace, monospace" : "inherit" }}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          style={inputStyle}
        />
      );
    case "boolean":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "#e2e4f5" }}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {value === true ? "Yes" : "No"}
        </label>
      );
    case "date":
      return <input type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
    case "image_url":
      return (
        <>
          <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder="https://example.com/image.jpg" style={inputStyle} />
          <span style={{ display: "block", fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", marginTop: "0.3rem" }}>Paste an image URL.</span>
        </>
      );
    case "url":
      return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder="https://example.com" style={inputStyle} />;
    case "text":
    default:
      return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
  }
}

export function EntriesClient({
  templateId,
  templateName,
  contentType,
  initialEntries,
}: {
  templateId: string;
  templateName: string;
  contentType: { id: string; name: string; slug: string; fields: ContentTypeField[] };
  initialEntries: EntrySummary[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/v1/templates/${templateId}/content-types/${contentType.id}/entries`;

  function openCreate() {
    setEditingId(null);
    setValues({});
    setStatus("DRAFT");
    setError(null);
    setModalOpen(true);
  }

  function openEdit(entry: EntrySummary) {
    setEditingId(entry.id);
    setValues(entry.data);
    setStatus(entry.status);
    setError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const url = editingId ? `${apiBase}/${editingId}` : apiBase;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: values, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save entry.");

      const preview = previewFor(contentType.fields, data.entry.data ?? {});
      const summary: EntrySummary = {
        id: data.entry.id,
        data: data.entry.data ?? {},
        status: data.entry.status ?? "DRAFT",
        preview,
        updatedAt: data.entry.updatedAt ?? new Date().toISOString(),
      };

      setEntries((prev) => (editingId ? prev.map((e) => (e.id === editingId ? summary : e)) : [summary, ...prev]));
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: EntrySummary) {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    const res = await fetch(`${apiBase}/${entry.id}`, { method: "DELETE" });
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    }
  }

  return (
    <PageContainer>
      <Link
        href={`/dashboard/templates/${templateId}/content-types`}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.5)", textDecoration: "none", marginBottom: "1.5rem" }}
      >
        <IconArrowLeft /> {templateName} · Content Types
      </Link>

      <div style={{ marginBottom: "2rem" }}>
        <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.35rem" }}>
          {contentType.slug}
        </p>
        <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.02em" }}>
          {contentType.name} entries
        </h1>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "1.5rem" }}>
        <button
          type="button" onClick={openCreate}
          style={{ padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff" }}
        >
          + New entry
        </button>
      </div>

      {entries.length === 0 ? (
        <Card style={{ padding: "3rem 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(240,242,255,0.7)" }}>No entries yet</p>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", marginTop: "0.3rem" }}>Add one to start populating this content type.</p>
        </Card>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left", background: "rgba(255,255,255,0.02)" }}>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Preview</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Status</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Updated</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5" }}>
                  <td style={{ padding: "0.7rem 1rem", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.preview}</td>
                  <td style={{ padding: "0.7rem 1rem" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, color: entry.status === "PUBLISHED" ? "#34d399" : "rgba(240,242,255,0.4)", background: entry.status === "PUBLISHED" ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 6 }}>
                      {entry.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.55)" }}>{new Date(entry.updatedAt).toLocaleDateString()}</td>
                  <td style={{ padding: "0.7rem 1rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                    <button type="button" onClick={() => openEdit(entry)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void handleDelete(entry)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
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
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", padding: "1rem", overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{ width: "min(100%,520px)", maxHeight: "90vh", overflowY: "auto", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem" }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "1.25rem" }}>
              {editingId ? "Edit entry" : "New entry"}
            </h2>

            <div style={{ display: "grid", gap: "1rem" }}>
              {contentType.fields.map((field) => (
                <FieldLabel key={field.id} label={field.name} required={field.required}>
                  <FieldInput
                    field={field}
                    value={values[field.key]}
                    onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                  />
                </FieldLabel>
              ))}

              <div>
                <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Status</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {(["DRAFT", "PUBLISHED"] as const).map((s) => (
                    <button
                      key={s} type="button" onClick={() => setStatus(s)}
                      style={{
                        flex: 1, padding: "0.55rem", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                        border: status === s ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
                        background: status === s ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
                        color: status === s ? "var(--brand)" : "rgba(240,242,255,0.6)", fontWeight: 600, fontSize: "0.82rem",
                      }}
                    >
                      {s === "DRAFT" ? "Draft" : "Published"}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p style={{ fontSize: "0.82rem", color: "#f87171" }}>{error}</p>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600 }}>
                  Cancel
                </button>
                <button
                  type="button" onClick={() => void handleSave()} disabled={saving}
                  style={{ padding: "0.6rem 1.4rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700 }}
                >
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create entry"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function previewFor(fields: ContentTypeField[], data: Record<string, unknown>): string {
  const textish = fields.filter((f) => f.type === "text" || f.type === "textarea" || f.type === "richtext");
  for (const field of textish) {
    const value = data[field.key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().length > 120 ? `${value.trim().slice(0, 120)}…` : value.trim();
    }
  }
  for (const field of fields) {
    const value = data[field.key];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }
  return "(empty entry)";
}
