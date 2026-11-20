"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "../../../../_components/PageContainer";
import { Card } from "../../../../_components/Card";
import { FIELD_TYPE_LABELS, SECTION_FIELD_TYPES, fieldKeyFrom, sampleDefaults, type SectionField, type SectionFieldType } from "@/lib/customSections/model";
import { LAYOUT_PRESETS } from "@/lib/customSections/presets";
import type { SectionTypeRow } from "@/lib/customSections/service";

// Make or change a section: what it's called, what people fill in (including a repeating group), and how it looks.
// Starts from a ready-made look so it works the moment it's saved; the HTML is there for people who want to fine-tune it.

type Row = { rowId: string; key?: string; label: string; type: SectionFieldType; hint?: string; placeholder?: string; itemName?: string; optionsText?: string; item?: Row[] };
let n = 0;
const rid = () => `r${++n}`;

const toRows = (fields: SectionField[]): Row[] =>
  fields.map((f) => ({ rowId: rid(), key: f.key, label: f.label, type: f.type, hint: f.hint, placeholder: f.placeholder, itemName: f.itemName, optionsText: f.options?.map((o) => o[1]).join(", "), item: f.item ? toRows(f.item) : undefined }));

const fromRows = (rows: Row[]): unknown[] =>
  rows
    .filter((r) => r.label.trim())
    .map((r) => ({
      ...(r.key ? { key: r.key } : {}),
      label: r.label,
      type: r.type,
      ...(r.hint?.trim() ? { hint: r.hint.trim() } : {}),
      ...(r.placeholder?.trim() ? { placeholder: r.placeholder.trim() } : {}),
      ...(r.type === "select" ? { options: (r.optionsText ?? "").split(",").map((o) => o.trim()).filter(Boolean) } : {}),
      ...(r.type === "list" ? { itemName: r.itemName || "item", item: fromRows(r.item ?? []) } : {}),
    }));

const input: React.CSSProperties = { width: "100%", background: "var(--ed-w-040)", border: "1px solid var(--ed-w-100)", borderRadius: 9, color: "var(--ed-text)", padding: "0.55rem 0.75rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" };
const primary: React.CSSProperties = { padding: "0.65rem 1.2rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "var(--ed-cta)", color: "var(--ed-on-brand)" };
const small: React.CSSProperties = { padding: "0.3rem 0.65rem", borderRadius: 8, border: "1px solid var(--ed-w-100)", background: "transparent", color: "var(--ed-text)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit" };
const h2: React.CSSProperties = { fontSize: "0.95rem", fontWeight: 800, color: "var(--ed-text)", marginBottom: "0.25rem" };
const hint: React.CSSProperties = { fontSize: "0.78rem", color: "var(--ed-t-450)", marginBottom: "0.8rem" };

function FieldRows({ rows, onChange, nested }: { rows: Row[]; onChange: (r: Row[]) => void; nested?: boolean }) {
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const types = nested ? SECTION_FIELD_TYPES.filter((t) => t !== "list") : SECTION_FIELD_TYPES;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      {rows.map((r, i) => (
        <div key={r.rowId} style={{ border: "1px solid var(--ed-w-080)", borderRadius: 10, padding: "0.65rem", background: nested ? "var(--ed-w-020)" : "transparent" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 11rem), 1fr))", gap: "0.5rem", alignItems: "center" }}>
            <input aria-label="Name" placeholder="What is it called? e.g. Name" value={r.label} onChange={(e) => set(i, { label: e.target.value })} style={input} />
            <select aria-label="Kind of field" value={r.type} onChange={(e) => set(i, { type: e.target.value as SectionFieldType, item: e.target.value === "list" ? (r.item?.length ? r.item : [{ rowId: rid(), label: "", type: "text" }]) : r.item })} style={input}>
              {types.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
            </select>
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => { const c = [...rows]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; onChange(c); }} style={small}>↑</button>
              <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => { const c = [...rows]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; onChange(c); }} style={small}>↓</button>
              <button type="button" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...small, color: "var(--ed-danger)" }}>Remove</button>
            </span>
          </div>
          {r.type === "select" && <input aria-label="Choices" placeholder="Choices, separated by commas" value={r.optionsText ?? ""} onChange={(e) => set(i, { optionsText: e.target.value })} style={{ ...input, marginTop: "0.5rem" }} />}
          {r.type !== "list" && (
            <details style={{ marginTop: "0.45rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, color: "var(--ed-t-500)" }}>Add help for the person filling it in</summary>
              <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.4rem" }}>
                <input aria-label="Help text" placeholder="A short tip shown under the box, e.g. Use a square photo" value={r.hint ?? ""} onChange={(e) => set(i, { hint: e.target.value })} style={input} />
                {["text", "longtext", "richtext", "button"].includes(r.type) && <input aria-label="Example text" placeholder="Example shown in the empty box, e.g. Ada Lovelace" value={r.placeholder ?? ""} onChange={(e) => set(i, { placeholder: e.target.value })} style={input} />}
              </div>
            </details>
          )}
          {r.type === "list" && (
            <div style={{ marginTop: "0.6rem", paddingLeft: "0.75rem", borderLeft: "2px solid var(--ed-w-100)" }}>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--ed-t-800)", marginBottom: 4 }}>
                What is one of these called?
                <input value={r.itemName ?? ""} placeholder="e.g. testimonial" onChange={(e) => set(i, { itemName: e.target.value })} style={{ ...input, display: "block", marginTop: 4, maxWidth: 260 }} />
              </label>
              <p style={{ ...hint, margin: "0.5rem 0" }}>What do you fill in for each one?</p>
              <FieldRows nested rows={r.item ?? []} onChange={(item) => set(i, { item })} />
            </div>
          )}
        </div>
      ))}
      <div><button type="button" onClick={() => onChange([...rows, { rowId: rid(), label: "", type: "text" }])} style={small}>+ Add {nested ? "a field to each one" : "another thing to fill in"}</button></div>
    </div>
  );
}

const TOKENS = ":root{--color-bg-canvas:#fff;--color-bg-surface:#fff;--color-bg-sunken:#f4f5f7;--color-text-primary:#111827;--color-text-secondary:#4b5563;--color-text-muted:#6b7280;--color-border-default:#e5e7eb;--color-brand-primary-500:#266ddc;--radius-lg:12px;--radius-xl:16px;--semantic-space-xs:.25rem;--semantic-space-sm:.5rem;--semantic-space-md:1rem;--semantic-space-lg:1.5rem;--semantic-space-xl:2.5rem;--font-size-sm:.875rem;--font-size-lg:1.125rem;--font-size-xl:1.25rem;--font-size-3xl:1.875rem;--font-family-heading:inherit}body{margin:0;padding:1.5rem;font-family:system-ui,sans-serif;color:#4b5563}";
const PREVIEW_TONE = { heading: "#111827", body: "#4b5563", muted: "#6b7280", accent: "#266ddc", line: "#e5e7eb", card: "#f4f5f7", onAccent: "#fff" };

export function SectionTypeEditor({ templateId, templateName, existing }: { templateId: string; templateName: string; existing: SectionTypeRow | null }) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [presetId, setPresetId] = useState<string | null>(existing ? null : LAYOUT_PRESETS[0].id);
  const [rows, setRows] = useState<Row[]>(() => toRows(existing?.fields ?? LAYOUT_PRESETS[0].fields));
  const [html, setHtml] = useState(existing?.html ?? LAYOUT_PRESETS[0].html);
  const [defaults, setDefaults] = useState<Record<string, unknown> | undefined>(existing?.defaults ?? LAYOUT_PRESETS[0].defaults);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [render, setRender] = useState<null | ((type: { fields: SectionField[]; html: string }, content: Record<string, unknown>, extra: Record<string, unknown>) => string)>(null);

  useEffect(() => {
    let off = false;
    import("@charisol/plexo-sdk/v2/compile").then((m) => !off && setRender(() => m.renderCustomSectionHtml as never)).catch(() => undefined);
    return () => { off = true; };
  }, []);

  function pick(id: string) {
    const p = LAYOUT_PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setRows(toRows(p.fields));
    setHtml(p.html);
    setDefaults(p.defaults);
  }

  async function draftFromIdea() {
    setDrafting(true);
    setError(null);
    setDraftNote(null);
    const res = await fetch(`/api/v1/templates/${templateId}/section-types/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description: idea }) });
    const data = await res.json().catch(() => ({}));
    setDrafting(false);
    if (!res.ok) return setError(data.error ?? "SOL couldn't draft that just now. Pick one of the ready-made looks instead.");
    setPresetId(null);
    setRows(toRows(data.draft.fields as SectionField[]));
    setHtml(data.draft.html as string);
    setDefaults(data.draft.defaults as Record<string, unknown> | undefined);
    setDraftNote("Here's a first draft. Check the preview, then change anything you like below.");
  }

  const fieldsPayload = useMemo(() => fromRows(rows), [rows]);
  const previewFields = useMemo(() => {
    const withKeys = (fs: SectionField[]): SectionField[] => fs.map((f) => ({ ...f, key: fieldKeyFrom(f.key || f.label), ...(f.item ? { item: withKeys(f.item) } : {}) }));
    return withKeys(fieldsPayload as SectionField[]);
  }, [fieldsPayload]);
  const sample = useMemo(() => defaults ?? sampleDefaults(previewFields), [defaults, previewFields]);
  const previewDoc = useMemo(() => {
    if (!render) return "";
    try {
      return `<!doctype html><meta charset="utf-8"><style>${TOKENS}</style>${render({ fields: previewFields, html }, sample, { align: "left", tone: PREVIEW_TONE })}`;
    } catch {
      return "";
    }
  }, [render, html, sample, previewFields]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const body = { name, description, fields: fieldsPayload, html, ...(defaults ? { defaults } : {}) };
    const res = await fetch(`/api/v1/templates/${templateId}/section-types${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? "We couldn't save that. Please try again.");
    if (existing) {
      const pages = data.pagesUpdated as number | undefined;
      return setNotice(pages ? `Saved. ${pages} ${pages === 1 ? "page was" : "pages were"} updated with the new design.` : "Saved.");
    }
    router.push(`/dashboard/templates/${templateId}/sections`);
    router.refresh();
  }

  const insertable = useMemo(() => {
    const out: string[] = [];
    for (const r of rows) {
      if (!r.label.trim()) continue;
      const key = r.key || fieldKeyFrom(r.label);
      if (r.type === "list") out.push(`{{#${key}}}…{{/${key}}}`, ...(r.item ?? []).filter((x) => x.label.trim()).map((x) => `{{${x.key || fieldKeyFrom(x.label)}}}`));
      else if (r.type === "button") out.push(`{{${key}.label}}`, `{{${key}.href}}`);
      else out.push(`{{${key}}}`);
    }
    return out;
  }, [rows]);

  return (
    <PageContainer>
      <Link href={`/dashboard/templates/${templateId}/sections`} style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--ed-t-500)", textDecoration: "none" }}>← Your sections · {templateName}</Link>
      <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "var(--ed-text)", letterSpacing: "-0.02em", margin: "0.75rem 0 1.5rem" }}>{existing ? `Change “${existing.name}”` : "Make a new section"}</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "1.25rem", alignItems: "start" }}>
        <div style={{ display: "grid", gap: "1.25rem" }}>
          <Card style={{ padding: "1.25rem 1.5rem" }}>
            <p style={h2}>1. What are you creating?</p>
            <p style={hint}>For example: Testimonials, Team members, FAQs, Pricing plans.</p>
            <input aria-label="What are you creating?" value={name} onChange={(e) => setName(e.target.value)} placeholder="Testimonials" style={input} />
            <input aria-label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short note to remind you what it’s for (optional)" style={{ ...input, marginTop: "0.5rem" }} />
          </Card>

          {!existing && (
            <Card style={{ padding: "1.25rem 1.5rem" }}>
              <p style={h2}>2. How should it look?</p>
              <p style={hint}>Pick a ready-made look, or describe it in your own words and SOL will draft it. You can change anything afterwards.</p>
              <div style={{ display: "grid", gap: "0.6rem" }}>
                {LAYOUT_PRESETS.map((p) => (
                  <button key={p.id} type="button" aria-pressed={presetId === p.id} onClick={() => pick(p.id)} style={{ textAlign: "left", padding: "0.8rem 1rem", borderRadius: 12, border: presetId === p.id ? "2px solid var(--ed-cta)" : "1px solid var(--ed-w-100)", background: "var(--ed-w-030)", color: "var(--ed-text)", cursor: "pointer", fontFamily: "inherit" }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "0.85rem" }}>{p.label}</span>
                    <span style={{ display: "block", fontSize: "0.75rem", color: "var(--ed-t-500)", marginTop: 2 }}>{p.blurb}</span>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--ed-w-080)" }}>
                <label htmlFor="section-idea" style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "var(--ed-text)", marginBottom: 4 }}>Or describe it</label>
                <textarea id="section-idea" value={idea} onChange={(e) => setIdea(e.target.value)} rows={3} placeholder="e.g. A menu with dish names, a short description, a price and a photo for each dish" style={{ ...input, resize: "vertical" }} />
                <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button type="button" onClick={draftFromIdea} disabled={drafting || idea.trim().length < 8} style={{ ...small, opacity: drafting || idea.trim().length < 8 ? 0.5 : 1 }}>{drafting ? "SOL is drafting…" : "Draft it for me"}</button>
                  {draftNote && <span role="status" style={{ fontSize: "0.78rem", color: "var(--ed-accent-text)" }}>{draftNote}</span>}
                </div>
              </div>
            </Card>
          )}

          <Card style={{ padding: "1.25rem 1.5rem" }}>
            <p style={h2}>{existing ? "What do people fill in?" : "3. What do people fill in?"}</p>
            <p style={hint}>These become the boxes you fill in each time you add the section to a page. Use <b>Formatted text</b> when words may need bold, links or lists, <b>Picture</b> to choose from your pictures, and a <b>repeating group</b> when there are several of something (dishes, people, quotes).</p>
            <FieldRows rows={rows} onChange={setRows} />
          </Card>

          <details style={{ border: "1px solid var(--ed-w-080)", borderRadius: 14, padding: "1rem 1.25rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.88rem", color: "var(--ed-text)" }}>Fine-tune the design</summary>
            <p style={{ ...hint, marginTop: "0.6rem" }}>Written in plain HTML. Put <code>{"{{name}}"}</code> where a field should appear, and wrap the part that repeats in <code>{"{{#group}}"}</code> … <code>{"{{/group}}"}</code>. Colours and spacing use your site&rsquo;s own, so it matches automatically. Scripts and unsafe code are removed.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {insertable.map((t) => <code key={t} style={{ fontSize: "0.72rem", padding: "2px 6px", borderRadius: 6, background: "var(--ed-w-040)" }}>{t}</code>)}
            </div>
            <textarea aria-label="Design" value={html} onChange={(e) => setHtml(e.target.value)} rows={14} spellCheck={false} style={{ ...input, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.78rem", lineHeight: 1.5 }} />
          </details>

          {error && <p role="alert" style={{ fontSize: "0.82rem", color: "var(--ed-danger)" }}>{error}</p>}
          {notice && <p role="status" style={{ fontSize: "0.82rem", color: "var(--ed-accent-text)" }}>{notice}</p>}
          <div><button type="button" onClick={save} disabled={saving} style={{ ...primary, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : existing ? "Save changes" : "Create section"}</button></div>
        </div>

        <Card style={{ padding: "1.25rem 1.5rem", position: "sticky", top: 16 }}>
          <p style={h2}>Preview</p>
          <p style={hint}>Colours here are only a sketch. On your page it takes on your site&rsquo;s own look.</p>
          {previewDoc ? (
            <iframe title="Preview of your section" sandbox="" srcDoc={previewDoc} style={{ width: "100%", height: 520, border: "1px solid var(--ed-w-080)", borderRadius: 10, background: "#fff" }} />
          ) : (
            <p style={{ fontSize: "0.8rem", color: "var(--ed-t-400)" }}>The preview will show up here.</p>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
