"use client";

import { useId, useState } from "react";
import { ICON_GROUPS } from "@charisol/plexo-sdk/v2/compile";
import { RichTextBox } from "./RichTextBox";
import type { SectionField } from "@/lib/customSections/model";

// The fill-in form for one use of a section — the same boxes, in the same order, as the page editor's panel: short and long
// text, formatted text, pictures from your library, links and buttons, switches, colours, choices, and repeating groups you
// can add to, reorder, copy and remove.

type Value = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const input: React.CSSProperties = { width: "100%", background: "var(--plx-surface)", border: "1px solid var(--plx-border)", borderRadius: 9, color: "var(--plx-text)", padding: "0.5rem 0.7rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" };
const small: React.CSSProperties = { padding: "0.35rem 0.65rem", borderRadius: 8, border: "1px solid var(--plx-border)", background: "var(--plx-surface)", color: "var(--plx-text)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--plx-text)", marginBottom: 4 };
const hintStyle: React.CSSProperties = { fontSize: "0.72rem", color: "var(--plx-muted)", marginTop: 4 };

type Picture = { id: string; name: string; url: string };

function PictureField({ id, value, onChange }: { id: string; value: string; onChange: (url: string) => void }) {
  const [library, setLibrary] = useState<Picture[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openLibrary() {
    const next = !open;
    setOpen(next);
    if (!next || library) return;
    const res = await fetch("/api/v1/media").catch(() => null);
    const data = res && res.ok ? await res.json().catch(() => []) : [];
    setLibrary(Array.isArray(data) ? (data as Picture[]) : []);
    if (!res || !res.ok) setError("We couldn't open your pictures. Please try again.");
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/media/upload", { method: "POST", body: form }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok || !data?.url) return setError(data?.error ?? "That picture couldn't be added. Please try another.");
    onChange(data.url as string);
  }
  const shown = value && !value.startsWith("data:image/svg") ? value : "";

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        {value ? <img src={value} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--plx-border)" }} /> : <span style={{ width: 56, height: 56, borderRadius: 8, border: "1px dashed var(--plx-border)" }} aria-hidden="true" />}
        <label style={{ ...small, display: "inline-block" }}>
          {busy ? "Uploading…" : value ? "Upload a new one" : "Upload a picture"}
          <input id={id} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button type="button" style={small} aria-expanded={open} onClick={() => void openLibrary()}>Choose from your pictures</button>
        {value ? <button type="button" style={{ ...small, color: "var(--plx-danger)", borderColor: "color-mix(in srgb, var(--plx-danger) 30%, transparent)" }} onClick={() => onChange("")}>Remove</button> : null}
      </div>
      {open && (
        <div style={{ border: "1px solid var(--plx-border)", borderRadius: 10, padding: "0.5rem", background: "var(--plx-surface)" }}>
          {library === null ? <p style={hintStyle}>Loading your pictures…</p> : library.length === 0 ? <p style={hintStyle}>You haven&rsquo;t added any pictures yet. Use &ldquo;Upload a picture&rdquo;.</p> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {library.map((m) => (
                <button key={m.id} type="button" title={m.name} aria-label={`Use ${m.name}`} aria-pressed={m.url === value} onClick={() => { onChange(m.url); setOpen(false); }} style={{ padding: 0, border: m.url === value ? "2px solid var(--plx-brand)" : "1px solid var(--plx-border)", borderRadius: 8, overflow: "hidden", background: "none", cursor: "pointer", aspectRatio: "1" }}>
                  <img src={m.url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <input aria-label="Or paste a picture link" value={shown} onChange={(e) => onChange(e.target.value)} placeholder="…or paste a picture link" style={input} />
      {error && <p role="alert" style={{ fontSize: "0.75rem", color: "var(--plx-danger)" }}>{error}</p>}
    </div>
  );
}

const blankFor = (f: SectionField): Value => {
  switch (f.type) {
    case "button": return { label: "", href: "" };
    case "toggle": return false;
    case "icon": return "star";
    case "select": return f.options?.[0]?.[0] ?? "";
    case "list": return Array.from({ length: f.min ?? 0 }, () => Object.fromEntries((f.item ?? []).map((x) => [x.key, blankFor(x)])));
    default: return "";
  }
};

function Rows({ field, rows, onChange, idBase }: { field: SectionField; rows: Value[]; onChange: (next: Value[]) => void; idBase: string }) {
  const name = field.itemName ?? "item";
  const max = field.limit ?? 60;
  const full = rows.length >= max;
  const move = (i: number, d: number) => { const n = rows.slice(); const [it] = n.splice(i, 1); n.splice(i + d, 0, it); onChange(n); };
  const copy = (i: number) => { const n = rows.slice(); const { _key: _drop, ...rest } = rows[i] ?? {}; void _drop; n.splice(i + 1, 0, JSON.parse(JSON.stringify(rest))); onChange(n); };
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      {rows.map((row, i) => (
        <div key={(row && row._key) || i} role="group" aria-label={`${name} ${i + 1} of ${rows.length}`} style={{ border: "1px solid var(--plx-border)", borderRadius: 12, padding: "0.75rem", background: "var(--plx-tint)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "0.78rem", textTransform: "capitalize", color: "var(--plx-text)" }}>{name} {i + 1}</strong>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button type="button" style={small} disabled={i === 0} aria-label={`Move ${name} ${i + 1} up`} onClick={() => move(i, -1)}>Move up</button>
              <button type="button" style={small} disabled={i === rows.length - 1} aria-label={`Move ${name} ${i + 1} down`} onClick={() => move(i, 1)}>Move down</button>
              <button type="button" style={small} disabled={full} aria-label={`Duplicate ${name} ${i + 1}`} onClick={() => copy(i)}>Duplicate</button>
              <button type="button" style={{ ...small, color: "var(--plx-danger)", borderColor: "color-mix(in srgb, var(--plx-danger) 30%, transparent)" }} disabled={rows.length <= (field.min ?? 0)} aria-label={`Remove ${name} ${i + 1}`} onClick={() => onChange(rows.filter((_, k) => k !== i))}>Remove</button>
            </span>
          </div>
          <Fields fields={field.item ?? []} values={row ?? {}} idBase={`${idBase}-${i}`} onChange={(k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))} />
        </div>
      ))}
      <div>
        <button type="button" style={small} disabled={full} onClick={() => onChange([...rows, Object.fromEntries((field.item ?? []).map((x) => [x.key, blankFor(x)]))])}>
          {full ? `That's the most you can add (${max})` : `+ Add ${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`}
        </button>
      </div>
    </div>
  );
}

export function Fields({ fields, values, onChange, idBase = "f" }: { fields: SectionField[]; values: Record<string, Value>; onChange: (key: string, value: Value) => void; idBase?: string }) {
  return (
    <div style={{ display: "grid", gap: "0.9rem" }}>
      {fields.map((f) => {
        const v = values[f.key];
        const id = `${idBase}-${f.key}`;
        return (
          <div key={f.key} role={f.type === "list" || f.type === "button" ? "group" : undefined} aria-labelledby={f.type === "list" || f.type === "button" ? `${id}-l` : undefined}>
            {f.type === "toggle" ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem", color: "var(--plx-text)", cursor: "pointer" }}>
                <input id={id} type="checkbox" checked={!!v} onChange={(e) => onChange(f.key, e.target.checked)} /> <span style={{ fontWeight: 700 }}>{f.label}</span>
              </label>
            ) : (
              <label id={`${id}-l`} htmlFor={["list", "button", "image", "richtext"].includes(f.type) ? undefined : id} style={labelStyle}>{f.label}</label>
            )}
            {f.type === "text" && <input id={id} style={input} value={typeof v === "string" ? v : ""} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />}
            {f.type === "longtext" && <textarea id={id} style={{ ...input, resize: "vertical" }} rows={3} value={typeof v === "string" ? v : ""} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />}
            {f.type === "richtext" && <RichTextBox id={id} label={f.label} placeholder={f.placeholder} value={typeof v === "string" ? v : ""} onChange={(html) => onChange(f.key, html)} />}
            {f.type === "image" && <PictureField id={id} value={typeof v === "string" ? v : ""} onChange={(url) => onChange(f.key, url)} />}
            {f.type === "link" && <input id={id} style={input} value={typeof v === "string" ? v : ""} placeholder="https://… or /about" onChange={(e) => onChange(f.key, e.target.value)} />}
            {f.type === "button" && (
              <div style={{ display: "grid", gap: 6 }}>
                <input aria-label={`${f.label} text`} style={input} value={v?.label ?? ""} placeholder={f.placeholder ?? "Button text (leave empty to hide the button)"} onChange={(e) => onChange(f.key, { ...(v ?? {}), label: e.target.value })} />
                <input aria-label={`${f.label} link`} style={input} value={v?.href ?? ""} placeholder="Where it goes: https://… or /contact" onChange={(e) => onChange(f.key, { ...(v ?? {}), href: e.target.value })} />
              </div>
            )}
            {f.type === "icon" && (
              <select id={id} style={input} value={typeof v === "string" ? v : "star"} onChange={(e) => onChange(f.key, e.target.value)}>
                {Object.entries(ICON_GROUPS).map(([group, names]) => (
                  <optgroup key={group} label={group}>{names.map((n) => <option key={n} value={n}>{n.replace(/-/g, " ")}</option>)}</optgroup>
                ))}
              </select>
            )}
            {f.type === "color" && <ColorField id={id} value={typeof v === "string" ? v : ""} onChange={(c) => onChange(f.key, c)} />}
            {f.type === "select" && (
              <select id={id} style={input} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(f.key, e.target.value)}>
                {(f.options ?? []).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            )}
            {f.type === "list" && <Rows field={f} idBase={id} rows={Array.isArray(v) ? v : []} onChange={(next) => onChange(f.key, next)} />}
            {f.hint && <p style={hintStyle}>{f.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ColorField({ id, value, onChange }: { id: string; value: string; onChange: (c: string) => void }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input id={id} type="color" value={valid ? value : "#266ddc"} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 32, padding: 2, borderRadius: 8, border: "1px solid var(--plx-border)", background: "var(--plx-surface)", cursor: "pointer" }} />
      <span style={{ fontSize: "0.78rem", color: "var(--plx-muted)" }}>{value || "Uses the design's own colour"}</span>
      {value ? <button type="button" style={small} onClick={() => onChange("")}>Reset</button> : null}
    </div>
  );
}

export function EntryForm({ fields, content, onChange }: { fields: SectionField[]; content: Record<string, Value>; onChange: (next: Record<string, Value>) => void }) {
  const base = useId().replace(/:/g, "");
  return <Fields fields={fields} values={content} idBase={base} onChange={(k, v) => onChange({ ...content, [k]: v })} />;
}
