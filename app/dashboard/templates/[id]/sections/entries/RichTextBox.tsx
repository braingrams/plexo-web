"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeRichText } from "@charisol/plexo-sdk/v2/compile";

// A small formatted-text box: Bold, Italic, Link, two kinds of list. What it hands back is always rebuilt through the same
// allow-list the published page uses, and pasted text is cleaned the same way, so only those few kinds of formatting get in.

const tool: React.CSSProperties = { padding: "0.25rem 0.55rem", borderRadius: 7, border: "1px solid var(--ed-w-100)", background: "transparent", color: "var(--ed-text)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit" };
const field: React.CSSProperties = { width: "100%", background: "var(--ed-w-040)", border: "1px solid var(--ed-w-100)", borderRadius: 9, color: "var(--ed-text)", padding: "0.5rem 0.7rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" };

export function RichTextBox({ value, onChange, label, placeholder, id }: { value: string; onChange: (html: string) => void; label: string; placeholder?: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef("");
  const saved = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("https://");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeRichText(value);
    if (clean !== last.current) {
      el.innerHTML = clean;
      last.current = clean;
    }
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const clean = sanitizeRichText(ref.current.innerHTML);
    last.current = clean;
    onChange(clean);
  };
  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const remember = () => {
    const sel = window.getSelection();
    saved.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const applyLink = (e: React.FormEvent) => {
    e.preventDefault();
    const url = href.trim();
    ref.current?.focus();
    const sel = window.getSelection();
    if (saved.current && sel) { sel.removeAllRanges(); sel.addRange(saved.current); }
    if (!url || url === "https://") document.execCommand("unlink");
    else document.execCommand("createLink", false, /^[a-z][a-z0-9+.-]*:|^[/#?]/i.test(url) ? url : `https://${url}`);
    setLinkOpen(false);
    emit();
  };
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div style={{ border: "1px solid var(--ed-w-100)", borderRadius: 9, background: "var(--ed-w-040)" }}>
      <div role="toolbar" aria-label={`${label} formatting`} style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 4, borderBottom: "1px solid var(--ed-w-080)" }}>
        <button type="button" style={{ ...tool, fontWeight: 800 }} aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={keep} onClick={() => run("bold")}>B</button>
        <button type="button" style={{ ...tool, fontStyle: "italic" }} aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={keep} onClick={() => run("italic")}>I</button>
        <button type="button" style={tool} aria-label="Add or change a link" aria-expanded={linkOpen} title="Link (Ctrl+K)" onMouseDown={keep} onClick={() => { remember(); setLinkOpen((o) => !o); }}>Link</button>
        <button type="button" style={tool} aria-label="Bulleted list" onMouseDown={keep} onClick={() => run("insertUnorderedList")}>• List</button>
        <button type="button" style={tool} aria-label="Numbered list" onMouseDown={keep} onClick={() => run("insertOrderedList")}>1. List</button>
        <button type="button" style={tool} aria-label="Remove formatting" onMouseDown={keep} onClick={() => run("removeFormat")}>Clear</button>
      </div>
      {linkOpen && (
        <form onSubmit={applyLink} style={{ display: "flex", gap: 6, padding: 6, borderBottom: "1px solid var(--ed-w-080)", flexWrap: "wrap" }}>
          <input autoFocus aria-label="Where should the link go?" value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://… (leave empty to remove the link)" style={{ ...field, flex: "1 1 12rem", width: "auto" }} />
          <button type="submit" style={tool}>Apply</button>
          <button type="button" style={tool} onClick={() => setLinkOpen(false)}>Cancel</button>
        </form>
      )}
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Type here…"}
        className="rich-box"
        style={{ minHeight: "5rem", padding: "0.55rem 0.75rem", fontSize: "0.85rem", color: "var(--ed-text)", outline: "none", lineHeight: 1.5 }}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); remember(); setLinkOpen(true); } }}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          document.execCommand("insertHTML", false, sanitizeRichText(html || e.clipboardData.getData("text/plain")));
          emit();
        }}
        onDrop={(e) => e.preventDefault()}
      />
      <style>{`.rich-box:empty::before{content:attr(data-placeholder);color:var(--ed-t-400);pointer-events:none}.rich-box a{text-decoration:underline;color:var(--ed-accent-text)}.rich-box ul{list-style:disc;padding-left:1.25rem}.rich-box ol{list-style:decimal;padding-left:1.25rem}.rich-box p{margin:0 0 .4rem}`}</style>
    </div>
  );
}
