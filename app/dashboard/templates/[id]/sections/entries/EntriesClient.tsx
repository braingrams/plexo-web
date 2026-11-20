"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageContainer, useEmbeddedScreen } from "../../../../_components/PageContainer";
import { SiteBackLink } from "../../../../_components/EditorTheme";
import { Card } from "../../../../_components/Card";
import type { SectionField } from "@/lib/customSections/model";
import { EntryForm } from "./EntryForm";

// "Entries": every place the site's own sections are used — each testimonial block, team grid or menu on every page — in one
// list you can search, jump from, change right here (the same boxes the page editor shows) and take off in bulk.

type Entry = { typeId: string; typeName: string; pageId: string; sectionId: string; pageTitle: string; pagePath: string; keyText: string; rows: number | null; draft: boolean; editedAt: string };
type TypeInfo = { id: string; name: string; repeats: string | null; count: number };
type Detail = { pageId: string; pageTitle: string; sectionId: string; typeId: string; typeName: string; fields: SectionField[]; content: Record<string, unknown>; draft: boolean };

const ghost: React.CSSProperties = { padding: "0.4rem 0.8rem", borderRadius: 9, border: "1px solid var(--ed-w-100)", background: "transparent", color: "var(--ed-text)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, fontFamily: "inherit", textDecoration: "none", display: "inline-block" };
const primary: React.CSSProperties = { ...ghost, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", fontWeight: 700 };
const input: React.CSSProperties = { width: "100%", background: "var(--ed-w-040)", border: "1px solid var(--ed-w-100)", borderRadius: 9, color: "var(--ed-text)", padding: "0.55rem 0.75rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" };

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ${d === 1 ? "day" : "days"} ago`;
  return new Date(t).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export function EntriesClient({ templateId, templateName, initialType }: { templateId: string; templateName: string; initialType: string }) {
  const embedded = useEmbeddedScreen();
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [typeId, setTypeId] = useState(initialType);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Entry | null>(null);
  const base = `/dashboard/templates/${templateId}/sections`;
  const keyOf = (e: Pick<Entry, "pageId" | "sectionId">) => `${e.pageId}:${e.sectionId}`;

  const load = useCallback(async () => {
    setError(null);
    const url = `/api/v1/templates/${templateId}/section-entries?${new URLSearchParams({ ...(typeId ? { typeId } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`;
    const res = await fetch(url).catch(() => null);
    const data = res && res.ok ? await res.json().catch(() => null) : null;
    setLoading(false);
    if (!data) return setError("We couldn't load your sections just now. Please refresh the page.");
    setTypes(data.types);
    setEntries(data.entries);
    setTotal(data.total);
    setPicked((prev) => new Set([...prev].filter((k) => (data.entries as Entry[]).some((e) => keyOf(e) === k))));
  }, [templateId, typeId, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const allPicked = entries.length > 0 && entries.every((e) => picked.has(keyOf(e)));
  const toggle = (e: Entry) => setPicked((p) => { const n = new Set(p); if (n.has(keyOf(e))) n.delete(keyOf(e)); else n.add(keyOf(e)); return n; });

  async function removePicked() {
    const items = entries.filter((e) => picked.has(keyOf(e))).map((e) => ({ pageId: e.pageId, sectionId: e.sectionId }));
    if (!items.length) return;
    if (!window.confirm(`Take ${items.length === 1 ? "this section" : `these ${items.length} sections`} off ${items.length === 1 ? "its page" : "their pages"}? The words in ${items.length === 1 ? "it" : "them"} will be gone, but you can add the section again any time.`)) return;
    setNotice(null);
    const res = await fetch(`/api/v1/templates/${templateId}/section-entries/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "We couldn't remove those. Please try again.");
    setPicked(new Set());
    setNotice(data.failed ? `Removed ${data.removed}. ${data.failed} couldn't be removed — please try those again.` : `Removed ${data.removed}.`);
    void load();
  }

  const active = types.find((t) => t.id === typeId);
  const nothingYet = !loading && types.every((t) => t.count === 0);
  const countLabel = useMemo(() => (total === 1 ? "1 place" : `${total} places`), [total]);

  return (
    <PageContainer>
      {!embedded && (
        <SiteBackLink siteId={templateId} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--ed-t-500)", textDecoration: "none", marginBottom: "1.5rem" }}>
          ← {templateName}
        </SiteBackLink>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "var(--ed-text)", letterSpacing: "-0.02em" }}>Section entries</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--ed-t-450)", marginTop: "0.4rem", maxWidth: 680 }}>
            Every place your own sections appear on the site. Change the words right here, or jump to the page. Changes go live straight away.
          </p>
        </div>
        <Link href={base} style={ghost}>Your sections</Link>
      </div>

      <div role="tablist" aria-label="Section" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.9rem" }}>
        {[{ id: "", name: "All", count: types.reduce((n, t) => n + t.count, 0) }, ...types].map((t) => (
          <button key={t.id || "all"} type="button" role="tab" aria-selected={typeId === t.id} onClick={() => { setTypeId(t.id); setPicked(new Set()); }} style={{ ...ghost, borderRadius: 999, ...(typeId === t.id ? { background: "var(--ed-cta)", color: "var(--ed-on-brand)", border: "1px solid transparent" } : {}) }}>
            {t.name} <span style={{ opacity: 0.75 }}>· {t.count}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.9rem" }}>
        <div style={{ flex: "1 1 16rem", maxWidth: 420 }}>
          <input type="search" aria-label="Search entries" placeholder="Search by words, page or section" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
        </div>
        <span role="status" style={{ fontSize: "0.78rem", color: "var(--ed-t-450)" }}>{loading ? "Loading…" : countLabel}</span>
        {picked.size > 0 && (
          <span style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--ed-t-700)" }}>{picked.size} chosen</span>
            <button type="button" style={{ ...ghost, color: "var(--ed-danger)" }} onClick={removePicked}>Take off their pages</button>
            <button type="button" style={ghost} onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        )}
      </div>

      {error && <p role="alert" style={{ fontSize: "0.82rem", color: "var(--ed-danger)", marginBottom: "0.75rem" }}>{error}</p>}
      {notice && <p role="status" style={{ fontSize: "0.82rem", color: "var(--ed-accent-text)", marginBottom: "0.75rem" }}>{notice}</p>}

      {!loading && entries.length === 0 ? (
        <Card style={{ padding: "2.5rem 2rem", textAlign: "center" }}>
          {nothingYet ? (
            <>
              <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--ed-t-700)" }}>None of your sections are on a page yet</p>
              <p style={{ fontSize: "0.82rem", color: "var(--ed-t-400)", margin: "0.4rem 0 1.2rem" }}>Open a page in the editor, choose <b>Add section</b>, then <b>Yours</b>. It will show up here as soon as it&rsquo;s on a page.</p>
              <Link href={base} style={primary}>See your sections</Link>
            </>
          ) : q ? (
            <p style={{ fontSize: "0.88rem", color: "var(--ed-t-500)" }}>Nothing matches &ldquo;{q}&rdquo;. Try fewer or different words.</p>
          ) : (
            <p style={{ fontSize: "0.88rem", color: "var(--ed-t-500)" }}>{active ? `“${active.name}” isn't on any page yet. Add it from a page's Add section panel, under Yours.` : "Nothing here yet."}</p>
          )}
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div role="table" aria-label="Where your sections are used" style={{ display: "grid" }}>
            <div role="row" style={{ display: "grid", gridTemplateColumns: "2rem minmax(0,2.2fr) minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,1fr) auto", gap: "0.75rem", padding: "0.6rem 1rem", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ed-t-450)", borderBottom: "1px solid var(--ed-w-080)" }} className="entries-head">
              <span role="columnheader"><input type="checkbox" aria-label="Choose all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(entries.map(keyOf)))} /></span>
              <span role="columnheader">What it says</span><span role="columnheader">Section</span><span role="columnheader">Page</span><span role="columnheader">Repeats</span><span role="columnheader">Last changed</span><span role="columnheader" style={{ textAlign: "right" }}>Actions</span>
            </div>
            {entries.map((e) => (
              <div role="row" key={keyOf(e)} className="entries-row" style={{ display: "grid", gridTemplateColumns: "2rem minmax(0,2.2fr) minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,1fr) auto", gap: "0.75rem", padding: "0.75rem 1rem", alignItems: "center", borderBottom: "1px solid var(--ed-w-060)", fontSize: "0.84rem", color: "var(--ed-text)" }}>
                <span role="cell"><input type="checkbox" aria-label={`Choose ${e.keyText || e.typeName} on ${e.pageTitle}`} checked={picked.has(keyOf(e))} onChange={() => toggle(e)} /></span>
                <span role="cell" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{e.keyText || <em style={{ color: "var(--ed-t-400)", fontWeight: 400 }}>Nothing written yet</em>}</span>
                <span role="cell" data-label="Section" style={{ color: "var(--ed-t-600)" }}>{e.typeName}</span>
                <span role="cell" data-label="Page" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.pageTitle} <span style={{ color: "var(--ed-t-400)" }}>{e.pagePath}</span></span>
                <span role="cell" data-label="Repeats" style={{ color: "var(--ed-t-600)" }}>{e.rows === null ? "—" : `${e.rows} ${types.find((t) => t.id === e.typeId)?.repeats ?? "row"}${e.rows === 1 ? "" : "s"}`}</span>
                <span role="cell" data-label="Changed" style={{ color: "var(--ed-t-600)" }}>{ago(e.editedAt)}{e.draft ? <span title="This page has changes that aren't published yet" style={{ marginLeft: 6, fontSize: "0.68rem", padding: "1px 6px", borderRadius: 999, background: "var(--ed-w-060)" }}>unpublished changes</span> : null}</span>
                <span role="cell" style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button type="button" style={primary} onClick={() => { setNotice(null); setEditing(e); }}>Edit</button>
                  <Link href={`/dashboard/templates/${e.pageId}`} style={ghost}>Open page</Link>
                </span>
              </div>
            ))}
          </div>
          {total > entries.length && <p style={{ padding: "0.75rem 1rem", fontSize: "0.78rem", color: "var(--ed-t-450)" }}>Showing the {entries.length} most recent. Search to find the others.</p>}
        </Card>
      )}
      <style>{`@media (max-width: 860px){.entries-head{display:none!important}.entries-row{grid-template-columns:2rem minmax(0,1fr)!important;row-gap:.35rem!important}.entries-row [role=cell]:nth-child(n+3){grid-column:2;white-space:normal!important}.entries-row [data-label]::before{content:attr(data-label) ": ";color:var(--ed-t-400)}.entries-row [role=cell]:last-child{justify-content:flex-start!important}}`}</style>

      {editing && (
        <EditPanel
          templateId={templateId}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); void load(); }}
        />
      )}
    </PageContainer>
  );
}

function EditPanel({ templateId, entry, onClose, onSaved }: { templateId: string; entry: Entry; onClose: () => void; onSaved: (msg: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const url = `/api/v1/templates/${templateId}/section-entries/${entry.pageId}/${entry.sectionId}`;

  useEffect(() => {
    let off = false;
    fetch(url).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (off) return;
      if (!res.ok) return setError(data.error ?? "We couldn't open that. Please try again.");
      setDetail(data.entry);
      setContent(data.entry.content);
    }).catch(() => !off && setError("We couldn't open that. Please check your connection."));
    return () => { off = true; };
  }, [url]);

  useEffect(() => { panel.current?.focus(); }, []);
  const close = () => { if (!dirty || window.confirm("Close without saving your changes?")) onClose(); };

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? "We couldn't save that. Please try again.");
    onSaved(data.hasWaitingChanges ? `Saved on “${entry.pageTitle}”. It's live now. The page's other unpublished changes are still waiting for you to publish them.` : `Saved on “${entry.pageTitle}”. It's live now.`);
  }

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={`Edit ${entry.typeName} on ${entry.pageTitle}`} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") close(); }} style={{ background: "var(--ed-panel)", color: "var(--ed-text)", width: "min(640px, 100%)", height: "100%", overflowY: "auto", padding: "1.25rem 1.5rem", boxShadow: "-8px 0 30px rgba(0,0,0,0.25)", outline: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>{entry.typeName}</h2>
            <p style={{ fontSize: "0.78rem", color: "var(--ed-t-450)", marginTop: 2 }}>On &ldquo;{entry.pageTitle}&rdquo; {entry.pagePath}</p>
          </div>
          <button type="button" style={ghost} onClick={close} aria-label="Close">Close</button>
        </div>
        {!detail && !error && <p style={{ fontSize: "0.85rem", color: "var(--ed-t-450)" }}>Opening…</p>}
        {detail && <EntryForm fields={detail.fields} content={content} onChange={(next) => { setContent(next); setDirty(true); }} />}
        {error && <p role="alert" style={{ fontSize: "0.82rem", color: "var(--ed-danger)", margin: "1rem 0" }}>{error}</p>}
        {detail && (
          <div style={{ position: "sticky", bottom: "-1.25rem", background: "var(--ed-panel)", borderTop: "1px solid var(--ed-w-080)", padding: "0.9rem 0 1.25rem", margin: "1rem 0 -1.25rem", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={{ ...primary, padding: "0.6rem 1.2rem", opacity: saving || !dirty ? 0.6 : 1 }} disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
            <button type="button" style={ghost} onClick={close}>Cancel</button>
            <Link href={`/dashboard/templates/${entry.pageId}`} style={{ ...ghost, marginLeft: "auto" }}>Open the page instead</Link>
          </div>
        )}
      </div>
    </div>
  );
}
