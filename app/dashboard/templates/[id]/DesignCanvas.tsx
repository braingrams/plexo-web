"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@/app/api/v1/templates/[id]/files/route";
import { buildPreviewHtml } from "./preview-utils";
import { injectBaseHref } from "@/lib/wpMigration/injectBaseHref";
import { annotateForDesign, applyElementEdit, describeElement, designBridgeScript, insertBeforeBodyClose, parseSource, type ElementEdit, type ElementInfo } from "@/lib/editorModes/htmlSource";

type Draft = { texts: Record<number, string>; href: string; src: string; alt: string };

const draftOf = (info: ElementInfo): Draft => ({
  texts: Object.fromEntries(info.texts.map((t) => [t.id, t.text])),
  href: info.link?.href ?? "",
  src: info.image?.src ?? "",
  alt: info.image?.alt ?? "",
});

/** Only what the owner actually changed, so Apply never rewrites something they didn't touch. */
export function editFromDraft(info: ElementInfo, draft: Draft): ElementEdit {
  const edit: ElementEdit = {};
  const texts = info.texts.filter((t) => draft.texts[t.id] !== undefined && draft.texts[t.id] !== t.text).map((t) => ({ id: t.id, text: draft.texts[t.id] }));
  if (texts.length) edit.texts = texts;
  if (info.link && draft.href !== info.link.href) edit.href = draft.href;
  if (info.image) {
    if (draft.src !== info.image.src) edit.src = draft.src;
    if (draft.alt !== info.image.alt) edit.alt = draft.alt;
  }
  return edit;
}

const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid var(--ed-w-120)", background: "var(--ed-w-040)", color: "var(--ed-text)", fontSize: "0.85rem", fontFamily: "inherit" };
const label: React.CSSProperties = { display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--ed-t-500)", margin: "0.7rem 0 0.25rem" };

/**
 * Design view for a page of your own code: the page as visitors see it. Click a word, a picture or a link and change it in
 * the panel; the change is written into the page's own code and only those characters change. The page's own scripts keep
 * running, but links and forms don't take you away.
 */
export function DesignCanvas({
  files,
  edits,
  html,
  onChangeHtml,
  baseHref,
  phone,
  onShowInCode,
}: {
  files: FileEntry[];
  edits: Record<string, string>;
  html: string;
  /** The page's code after a change made here. */
  onChangeHtml: (next: string) => void;
  baseHref?: string | null;
  phone?: boolean;
  /** Jump to this place in the Code view. */
  onShowInCode?: (offset: number) => void;
}) {
  const doc = useMemo(() => parseSource(html), [html]);
  const [picked, setPicked] = useState<number | null>(null);
  const info = useMemo(() => (picked !== null ? describeElement(doc, picked) : null), [doc, picked]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [srcDoc, setSrcDoc] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const pickedRef = useRef<number | null>(null);
  pickedRef.current = picked;
  const cleanup = useRef<(() => void) | null>(null);

  // A new element, or the page changed underneath (undo, Code, SOL): start the panel from what is really there.
  useEffect(() => {
    setDraft(info ? draftOf(info) : null);
    setUploadError(null);
  }, [info]);

  useEffect(() => {
    const t = setTimeout(() => {
      const withBridge = insertBeforeBodyClose(annotateForDesign(html, doc), designBridgeScript({ scrollY: scrollY.current, selected: pickedRef.current ?? -1 }));
      const built = buildPreviewHtml(files, { ...edits, "index.html": withBridge }, "index.html");
      cleanup.current?.();
      cleanup.current = built.cleanup;
      setSrcDoc(injectBaseHref(built.html, baseHref ?? null));
    }, 200);
    return () => clearTimeout(t);
  }, [files, edits, html, doc, baseHref]);

  useEffect(() => () => cleanup.current?.(), []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { plx?: string; index?: number; y?: number } | null;
      if (!d || typeof d !== "object") return;
      if (d.plx === "pick" && typeof d.index === "number") setPicked(d.index >= 0 ? d.index : null);
      else if (d.plx === "scroll" && typeof d.y === "number") scrollY.current = d.y;
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const changes = info && draft ? editFromDraft(info, draft) : {};
  const dirty = Object.keys(changes).length > 0;

  const apply = useCallback(() => {
    if (!info || !draft || !dirty) return;
    onChangeHtml(applyElementEdit(html, info.index, changes, doc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, draft, dirty, html, doc, onChangeHtml]);

  const close = () => {
    setPicked(null);
    frame.current?.contentWindow?.postMessage({ plx: "select", index: -1 }, "*");
  };

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "We couldn't upload that picture. Try a PNG, JPG or WebP under 8 MB.");
      setDraft((d) => (d ? { ...d, src: data.url! } : d));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "We couldn't upload that picture.");
    } finally {
      setUploading(false);
    }
  }

  const el = info ? doc.elements[info.index] : null;
  return (
    <div className="plx-dc" style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", justifyContent: "center", background: phone ? "var(--ed-w-040)" : "transparent" }}>
        <iframe
          ref={frame}
          title="Your page. Click anything to change it."
          srcDoc={srcDoc}
          // Scripts run, but without access to this dashboard (no same-origin): the page is the owner's own, unsanitised code.
          sandbox="allow-scripts"
          style={{ width: phone ? 390 : "100%", maxWidth: "100%", height: "100%", border: "none", background: "#fff", boxShadow: phone ? "0 0 0 1px var(--ed-w-100)" : "none" }}
        />
      </div>
      <aside
        className="plx-dc-panel"
        aria-label="Change this part of the page"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
        style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--ed-w-080)", background: "var(--ed-bg)", overflowY: "auto", padding: "0.9rem" }}
      >
        {!info || !draft ? (
          <div style={{ color: "var(--ed-t-500)", fontSize: "0.85rem", lineHeight: 1.55 }}>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--ed-t-800)" }}>Click anything on your page</p>
            <p style={{ margin: "0.4rem 0 0" }}>Pick a heading, a paragraph, a button, a link or a picture, and change it right here. Your page keeps its look.</p>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: "0.9rem" }}>{info.label}</strong>
              <button type="button" onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: "var(--ed-t-600)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}>
                ×
              </button>
            </div>

            {info.kind === "other" && (
              <p style={{ margin: "0.6rem 0 0", fontSize: "0.82rem", lineHeight: 1.55, color: "var(--ed-t-600)" }}>
                {info.link
                  ? "This part has no words or picture of its own to change here, but it is a link."
                  : "There is nothing to change here by clicking. It may be empty, a drawing, or filled in by the page's own scripts. Use Code to change it."}
              </p>
            )}

            {info.texts.map((t, i) => (
              <div key={t.id}>
                <label htmlFor={`plx-dc-t-${t.id}`} style={label}>
                  {info.texts.length > 1 ? `Words ${i + 1}` : "Words"}
                </label>
                <textarea id={`plx-dc-t-${t.id}`} rows={Math.min(8, Math.max(2, Math.ceil((draft.texts[t.id] ?? "").length / 34)))} value={draft.texts[t.id] ?? ""} onChange={(e) => setDraft({ ...draft, texts: { ...draft.texts, [t.id]: e.target.value } })} style={{ ...field, resize: "vertical" }} />
              </div>
            ))}

            {info.image && (
              <div>
                <span style={label}>Picture</span>
                {draft.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.src} alt="" style={{ maxWidth: "100%", maxHeight: 140, borderRadius: 8, border: "1px solid var(--ed-w-100)", display: "block", marginBottom: 8, background: "var(--ed-w-040)" }} />
                ) : null}
                <label style={{ display: "inline-block", padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid var(--ed-w-120)", fontSize: "0.8rem", fontWeight: 600, cursor: uploading ? "wait" : "pointer", color: "var(--ed-t-800)" }}>
                  {uploading ? "Uploading…" : "Choose a new picture"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploading}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void upload(f);
                    }}
                  />
                </label>
                {uploadError && (
                  <p role="alert" style={{ fontSize: "0.78rem", color: "var(--ed-danger)", margin: "0.4rem 0 0" }}>
                    {uploadError}
                  </p>
                )}
                <label htmlFor="plx-dc-src" style={label}>Or paste a picture&rsquo;s web address</label>
                <input id="plx-dc-src" value={draft.src} onChange={(e) => setDraft({ ...draft, src: e.target.value })} style={field} placeholder="https://…" />
                <label htmlFor="plx-dc-alt" style={label}>Describe the picture (for people who can&rsquo;t see it)</label>
                <input id="plx-dc-alt" value={draft.alt} onChange={(e) => setDraft({ ...draft, alt: e.target.value })} style={field} />
              </div>
            )}

            {info.link && (
              <div>
                <label htmlFor="plx-dc-href" style={label}>
                  {info.tag === "a" || info.kind === "text" ? "Where this link goes" : "Where this picture's link goes"}
                </label>
                <input id="plx-dc-href" value={draft.href} onChange={(e) => setDraft({ ...draft, href: e.target.value })} style={field} placeholder="/about or https://…" />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: "1rem", flexWrap: "wrap" }}>
              <button type="button" onClick={apply} disabled={!dirty} style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", fontWeight: 700, fontSize: "0.82rem", cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.5, fontFamily: "inherit" }}>
                Apply
              </button>
              <button type="button" onClick={() => info && setDraft(draftOf(info))} disabled={!dirty} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid var(--ed-w-120)", background: "none", color: "var(--ed-t-800)", fontWeight: 600, fontSize: "0.82rem", cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.5, fontFamily: "inherit" }}>
                Undo these
              </button>
            </div>
            {dirty && <p style={{ margin: "0.5rem 0 0", fontSize: "0.74rem", color: "var(--ed-t-500)" }}>Press Apply to see it on the page. Then Save to keep it.</p>}
            {onShowInCode && el && (
              <button type="button" onClick={() => onShowInCode(el.start)} style={{ marginTop: "0.9rem", background: "none", border: "none", padding: 0, color: "var(--ed-accent-text)", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
                Show this in the code
              </button>
            )}
          </div>
        )}
      </aside>
      <style jsx>{`
        @media (max-width: 900px) {
          .plx-dc {
            flex-direction: column;
          }
          .plx-dc-panel {
            width: 100% !important;
            max-height: 45%;
            border-left: none !important;
            border-top: 1px solid var(--ed-w-120);
          }
        }
      `}</style>
    </div>
  );
}
