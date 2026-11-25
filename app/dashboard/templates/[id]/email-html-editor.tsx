"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CodeMirror, { EditorView, keymap } from "@uiw/react-codemirror";
import { Monitor, Redo2, Smartphone, Undo2 } from "lucide-react";
import { html as htmlLang } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import { checkAiCredits, generateWithProgress, type AiRequestBody } from "@/lib/ai/clientGenerate";
import { EMAIL_MERGE_TAGS, emailHtmlWarnings, findMergeTags, tagToken } from "@/lib/email/mergeTags";
import { applyEdit, BLOCKS, buildPreviewDoc, type BlockKind, type DragEdit, type Pos } from "@/lib/email/dragEdit";
import { pageZoom } from "@/lib/dashboardV3/pageZoom";
import { emailsListHref } from "@/lib/dashboardV3/emails";
import { useEditorV3 } from "../../_components/EditorTheme";
import { SolOutOfCredits } from "../../_components/sol/SolTopUp";
import { useV3ThemeOptional } from "../../_v3/theme/ThemeContext";

type Props = { templateId: string; templateName: string; initialHtml: string; useAi: boolean; /** Shown inside the dashboard (sidebar and top bar around it) instead of full screen. */ embedded?: boolean };
type Save = "saved" | "saving" | "error";

const btn: React.CSSProperties = { font: "inherit", fontSize: "0.82rem", fontWeight: 600, padding: "0.4rem 0.8rem", borderRadius: 999, border: "1px solid var(--ed-w-120, rgba(128,128,128,.35))", background: "transparent", color: "var(--ed-text)", cursor: "pointer" };

const iconBtn: React.CSSProperties = { ...btn, width: 34, height: 34, padding: 0, display: "inline-grid", placeItems: "center", borderRadius: 10 };

/** An email written as HTML: code on one side, the real email on the other, updating as you type. SOL can change it too. */
export function EmailHtmlEditor({ templateId, templateName, initialHtml, useAi, embedded }: Props) {
  const v3 = useEditorV3();
  const E = !!embedded;
  const resolvedTheme = useV3ThemeOptional()?.resolved ?? "dark";
  // Panels, when embedded: rounded cards that sit on the dashboard like every other screen.
  const card: React.CSSProperties = E ? { border: "1px solid var(--ed-w-100)", borderRadius: 18, overflow: "hidden", background: "var(--ed-panel)" } : {};
  const [code, setCode] = useState(initialHtml);
  const [save, setSave] = useState<Save>("saved");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [filled, setFilled] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"sol" | "upload" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [broke, setBroke] = useState(false);
  // Undo / redo for everything: typing (grouped into bursts), drags, edits on the preview, SOL's changes.
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const burstBase = useRef<string | null>(null);
  const burstTimer = useRef<number | undefined>(undefined);
  const [steps, setSteps] = useState({ undo: 0, redo: 0 });
  const syncSteps = () => setSteps({ undo: past.current.length, redo: future.current.length });
  // Where "Insert field" should go: the code box if that is where you last clicked, the preview while you are editing text there.
  const lastFocus = useRef<"code" | "preview" | null>(null);
  const previewEditing = useRef(false);
  // A block carried from the strip onto the preview. The browser's own drag-and-drop doesn't reliably reach into the preview
  // (it is a sandboxed page), so the chip follows the mouse itself and tells the preview where it is.
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  function carryBlock(e: React.PointerEvent<HTMLElement>, block: { kind: BlockKind; label: string }) {
    if (e.button !== 0) return;
    e.preventDefault();
    const chip = e.currentTarget;
    try { chip.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const tell = (type: "dragStart" | "dragMove" | "dragDrop", ev: PointerEvent) => {
      const f = frame.current;
      if (!f?.contentWindow) return;
      const r = f.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      f.contentWindow.postMessage({ plx: type, kind: block.kind, label: block.label, x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, inside }, "*");
    };
    const z = pageZoom(chip);
    const move = (ev: PointerEvent) => { setGhost({ label: block.label, x: ev.clientX / z, y: ev.clientY / z }); tell("dragMove", ev); };
    const done = (ev: PointerEvent, drop: boolean) => {
      chip.removeEventListener("pointermove", move);
      chip.removeEventListener("pointerup", up);
      chip.removeEventListener("pointercancel", cancel);
      try { chip.releasePointerCapture(ev.pointerId); } catch { /* fine */ }
      setGhost(null);
      tell("dragDrop", drop ? ev : ({ ...ev, clientX: -1, clientY: -1 } as PointerEvent));
    };
    const up = (ev: PointerEvent) => done(ev, true);
    const cancel = (ev: PointerEvent) => done(ev, false);
    chip.addEventListener("pointermove", move);
    chip.addEventListener("pointerup", up);
    chip.addEventListener("pointercancel", cancel);
    tell("dragStart", e.nativeEvent);
    move(e.nativeEvent);
  }
  const view = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [shown, setShown] = useState(initialHtml);
  const lastSaved = useRef(initialHtml);
  const codeRef = useRef(code);
  codeRef.current = code;

  const flushBurst = () => {
    window.clearTimeout(burstTimer.current);
    const base = burstBase.current;
    burstBase.current = null;
    if (base !== null && base !== codeRef.current) {
      past.current.push(base);
      future.current = [];
      syncSteps();
    }
  };
  /** Any change that isn't typing: one undo step. */
  const commit = (next: string) => {
    flushBurst();
    past.current.push(codeRef.current);
    future.current = [];
    setCode(next);
    syncSteps();
  };
  /** Typing in the code box: keystrokes close together are one undo step. */
  const typed = (value: string) => {
    if (value === codeRef.current) return;
    if (burstBase.current === null) burstBase.current = codeRef.current;
    setCode(value);
    window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(flushBurst, 700);
  };
  const undo = () => {
    flushBurst();
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(codeRef.current);
    setCode(prev);
    syncSteps();
  };
  const redo = () => {
    flushBurst();
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(codeRef.current);
    setCode(next);
    syncSteps();
  };

  const doSave = useCallback(async () => {
    const content = codeRef.current;
    if (content === lastSaved.current) return setSave("saved");
    setSave("saving");
    try {
      const r = await fetch(`/api/v1/templates/${templateId}/files/index.html`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!r.ok) throw new Error();
      lastSaved.current = content;
      setSave(codeRef.current === content ? "saved" : "saving");
    } catch {
      setSave("error");
    }
  }, [templateId]);

  // Saves itself a moment after you stop typing.
  useEffect(() => {
    if (code === lastSaved.current) return;
    setSave("saving");
    const t = window.setTimeout(() => void doSave(), 1200);
    return () => window.clearTimeout(t);
  }, [code, doSave]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (codeRef.current !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const insert = (text: string) => {
    const v = view.current;
    if (!v) return commit(codeRef.current + text);
    v.dispatch(v.state.replaceSelection(text));
    v.focus();
  };

  /**
   * "Insert field": at the cursor, wherever you were working. In the code box that is its cursor or selection; while you are editing
   * text on the preview it is that caret; with neither, it goes after the last text on the page instead of at the very top.
   */
  const insertTag = (key: string) => {
    const token = tagToken(key);
    if (previewEditing.current && frame.current?.contentWindow) {
      // Typed in as the tag itself; it shows as the sample name as soon as you finish editing that text.
      frame.current.contentWindow.postMessage({ plx: "insertTag", text: token }, "*");
      return;
    }
    if (lastFocus.current === "code" && view.current) return insert(token);
    const next = applyEdit(codeRef.current, { type: "appendTag", tag: token });
    if (next === null) return;
    commit(next);
    setNote({ tone: "ok", text: "Added after the last text. Click where you want it first to put it there instead." });
  };

  /** Uploads a picture so it has a real web address that works in the email. */
  async function uploadPicture(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/v1/media/upload", { method: "POST", body: form });
    const d = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok || !d.url) throw new Error(d.error || "That picture couldn't be added.");
    return d.url;
  }

  async function addPicture(file: File, drop?: { target: number | null; pos: Pos }) {
    setBusy("upload");
    setNote(null);
    try {
      const url = await uploadPicture(file);
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/["<>]/g, "");
      if (drop) applyDrag({ type: "insertImage", url, alt, target: drop.target, pos: drop.pos }, "Picture added.");
      else {
        insert(`<img src="${url}" alt="${alt}" width="560" style="display:block;max-width:100%;height:auto;border:0;">`);
        setNote({ tone: "ok", text: "Picture added. It's hosted for you, so it shows in the email." });
      }
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "That picture couldn't be added." });
    } finally {
      setBusy(null);
    }
  }

  /** A drag in the preview, written into the HTML. Undo puts it back. */
  function applyDrag(edit: DragEdit, done: string) {
    const next = applyEdit(codeRef.current, edit);
    if (next === null) return setNote({ tone: "bad", text: "That spot doesn't work. Try dropping it somewhere else." });
    commit(next);
    setNote({ tone: "ok", text: done });
  }

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { plx?: number; edit?: DragEdit; scroll?: number; editing?: boolean; file?: File; target?: number | null; pos?: Pos } | null;
      if (!m || m.plx !== 1) return;
      if (typeof m.scroll === "number") scrollY.current = m.scroll;
      else if (typeof m.editing === "boolean") {
        previewEditing.current = m.editing;
        if (m.editing) lastFocus.current = "preview";
      }
      else if (m.edit) applyDrag(m.edit, m.edit.type === "move" ? "Moved." : m.edit.type === "text" ? "Text changed." : m.edit.type === "remove" ? "Deleted." : m.edit.type === "duplicate" ? "Copied." : "Added.");
      else if (m.file instanceof File) void addPicture(m.file, { target: m.target ?? null, pos: m.pos ?? "inside" });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function askSol() {
    if (!prompt.trim()) return;
    setBusy("sol");
    setNote(null);
    setBroke(false);
    try {
      const request: AiRequestBody = {
        mode: "edit_raw_html",
        prompt: `${prompt.trim()}\n\nThis is an email: keep it email-safe (tables and inline styles) and keep every {{merge_tag}} exactly as written.`,
        templateKind: "EMAIL",
        context: { html: codeRef.current },
      };
      const credits = await checkAiCredits(request);
      if (credits && !credits.enough) {
        setBroke(credits.paidBy === "plexo" && credits.estimatedCredits !== null);
        throw new Error(credits.message ?? "SOL needs more credits to do this. Add some, then try again.");
      }
      const data = await generateWithProgress(request, () => undefined);
      commit(data.result as string);
      setPrompt("");
      setNote({ tone: "ok", text: data.summary || "Done. Your email is updated." });
    } catch (e) {
      const m = e instanceof Error ? e.message : "SOL couldn't finish that. Please try again.";
      if (/enough (AI )?credits|out of (AI )?credits|needs more credits/i.test(m)) setBroke(true);
      setNote({ tone: "bad", text: m });
    } finally {
      setBusy(null);
    }
  }

  // The preview follows what you type a moment after you stop, and keeps its scroll place.
  useEffect(() => {
    const t = window.setTimeout(() => setShown(code), 250);
    return () => window.clearTimeout(t);
  }, [code]);
  const doc = useMemo(() => buildPreviewDoc(shown, { filled, scrollY: scrollY.current, interactive: true }), [shown, filled]);
  const used = useMemo(() => findMergeTags(code), [code]);
  const unknown = used.filter((t) => !t.known).map((t) => tagToken(t.key));
  const warnings = useMemo(() => emailHtmlWarnings(code), [code]);
  const saveText = save === "saving" ? "Saving…" : save === "error" ? "Couldn't save. Trying again when you type." : "All changes saved";

  return (
    <div style={E ? { height: "calc(var(--plx-dvh, 100dvh) - 73px)", display: "flex", flexDirection: "column", gap: 16, padding: "20px 28px 24px", color: "var(--ed-text)" } : { height: "100vh", display: "flex", flexDirection: "column", background: "var(--ed-bg)", color: "var(--ed-text)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: E ? 0 : "0.6rem 1rem", borderBottom: E ? "none" : "1px solid var(--ed-w-080)", flexWrap: "wrap" }}>
        <Link href={emailsListHref(v3)} style={{ color: E ? "var(--ed-t-600)" : "var(--ed-text)", fontWeight: 600, fontSize: "0.85rem", textDecoration: "none" }}>← Emails</Link>
        <strong style={{ fontSize: E ? "1.35rem" : "0.95rem", fontWeight: E ? 800 : 700, letterSpacing: E ? "-0.02em" : undefined }}>{templateName}</strong>
        <span aria-live="polite" style={{ fontSize: "0.78rem", color: save === "error" ? "var(--ed-danger)" : "var(--ed-t-500)" }}>{saveText}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...iconBtn, opacity: steps.undo ? 1 : 0.4 }} onMouseDown={(e) => e.preventDefault()} onClick={undo} disabled={!steps.undo} aria-label="Undo" title="Undo (Ctrl or ⌘ + Z)"><Undo2 size={16} aria-hidden /></button>
        <button type="button" style={{ ...iconBtn, opacity: steps.redo ? 1 : 0.4 }} onMouseDown={(e) => e.preventDefault()} onClick={redo} disabled={!steps.redo} aria-label="Redo" title="Redo (Ctrl or ⌘ + Shift + Z)"><Redo2 size={16} aria-hidden /></button>
        <div style={{ position: "relative" }}>
          <button type="button" style={btn} aria-expanded={tagsOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => setTagsOpen((o) => !o)}>Insert field ▾</button>
          {tagsOpen ? (
            <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, minWidth: 260, padding: 6, borderRadius: 12, background: "var(--ed-bg)", border: "1px solid var(--ed-w-120, rgba(128,128,128,.35))", boxShadow: "0 12px 32px rgba(0,0,0,.25)" }}>
              {EMAIL_MERGE_TAGS.map((t) => (
                <button key={t.key} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { insertTag(t.key); setTagsOpen(false); }} style={{ ...btn, display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: 8, padding: "0.5rem 0.7rem" }}>
                  <span style={{ display: "block" }}>{t.label}</span>
                  <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 400, color: "var(--ed-t-500)" }}>{t.help}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" style={btn} disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>{busy === "upload" ? "Adding…" : "Add a picture"}</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addPicture(f); }} />
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: E ? 16 : 0 }} className="plx-emed">
        <section style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: E ? undefined : "1px solid var(--ed-w-080)", ...card }}>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} onFocusCapture={() => { lastFocus.current = "code"; }}>
            <CodeMirror value={code} height="100%" placeholder="Paste your email's HTML here, or write it. Your email shows on the right as you type." theme={resolvedTheme === "light" ? "light" : oneDark} extensions={[htmlLang(), EditorView.lineWrapping, keymap.of([{ key: "Mod-z", run: () => { undo(); return true; } }, { key: "Mod-Shift-z", run: () => { redo(); return true; } }, { key: "Mod-y", run: () => { redo(); return true; } }])]} onChange={typed} onCreateEditor={(v) => { view.current = v; }} basicSetup={{ foldGutter: false, history: false }} style={{ height: "100%", fontSize: 13 }} />
          </div>
          {warnings.length || unknown.length ? (
            <ul style={{ margin: 0, padding: "0.6rem 1rem 0.6rem 2rem", fontSize: "0.78rem", lineHeight: 1.5, color: "var(--ed-t-500)", borderTop: "1px solid var(--ed-w-080)", maxHeight: 120, overflow: "auto" }}>
              {unknown.length ? <li>{unknown.join(", ")} {unknown.length === 1 ? "isn't a field" : "aren't fields"} we fill in, so {unknown.length === 1 ? "it" : "they"} will show as written. Use Insert field for the ones that work.</li> : null}
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : null}
          {useAi ? (
            <div style={{ padding: "0.7rem 1rem", borderTop: "1px solid var(--ed-w-080)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && busy === null && void askSol()} placeholder="Ask SOL to change it: “make the button green and the heading shorter”" aria-label="Change this email with SOL" style={{ flex: 1, font: "inherit", fontSize: "0.88rem", padding: "0.55rem 0.8rem", borderRadius: 10, border: "1px solid var(--ed-w-120, rgba(128,128,128,.35))", background: "var(--ed-w-050)", color: "var(--ed-text)" }} />
                <button type="button" disabled={busy !== null || !prompt.trim()} onClick={() => void askSol()} style={{ ...btn, background: "var(--ed-cta)", color: "var(--ed-on-brand)", border: 0 }}>{busy === "sol" ? "SOL is working…" : "Change it"}</button>
              </div>
              {broke ? <SolOutOfCredits onDismiss={() => setBroke(false)} onToppedUp={() => { setBroke(false); setNote(null); void askSol(); }} /> : null}
            </div>
          ) : null}
          {note ? (
            <p role={note.tone === "bad" ? "alert" : "status"} style={{ margin: 0, padding: "0.5rem 1rem", fontSize: "0.8rem", color: note.tone === "bad" ? "var(--ed-danger)" : "var(--ed-t-500)", display: "flex", gap: 10, alignItems: "center" }}>
              <span>{note.text}</span>
            </p>
          ) : null}
        </section>

        <section style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--ed-w-050)", ...(E ? { ...card, background: "var(--ed-sunken)" } : {}) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.5rem 1rem", borderBottom: "1px solid var(--ed-w-080)", flexWrap: "wrap" }}>
            <div role="group" aria-label="Screen size" style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 12, background: "var(--ed-w-050)" }}>
              {(["desktop", "phone"] as const).map((d) => (
                <button key={d} type="button" aria-pressed={device === d} aria-label={d === "desktop" ? "Computer" : "Phone"} title={d === "desktop" ? "Computer" : "Phone"} onClick={() => setDevice(d)} style={{ ...iconBtn, border: 0, width: 32, height: 30, borderRadius: 9, background: device === d ? "var(--ed-w-120, rgba(128,128,128,.2))" : "transparent" }}>
                  {d === "desktop" ? <Monitor size={16} aria-hidden /> : <Smartphone size={16} aria-hidden />}
                </button>
              ))}
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--ed-t-500)", cursor: "pointer", marginLeft: "auto" }}>
              <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} /> Show sample names
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.45rem 1rem", borderBottom: "1px solid var(--ed-w-080)", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--ed-t-500)" }}>Drag onto your email:</span>
            {BLOCKS.map((b) => (
              <span key={b.kind} role="button" tabIndex={0} aria-label={`Drag ${b.label} onto your email`} onPointerDown={(e) => carryBlock(e, b)} style={{ ...btn, cursor: "grab", padding: "0.25rem 0.7rem", userSelect: "none", touchAction: "none" }}>{b.label}</span>
            ))}
            <span style={{ fontSize: "0.74rem", color: "var(--ed-t-500)" }}>Double-click any text to edit it. Hover a block to move, copy or delete it. Drop a picture from your computer to add it.</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", padding: 16 }}>
            {code.trim() ? (
              <iframe ref={frame} title="Email preview" srcDoc={doc} sandbox="allow-scripts" style={{ border: 0, background: "#fff", borderRadius: 10, width: "100%", maxWidth: device === "phone" ? 375 : 680, height: "100%", minHeight: 420 }} />
            ) : (
              <p style={{ alignSelf: "center", textAlign: "center", maxWidth: 300, fontSize: "0.88rem", color: "var(--ed-t-500)" }}>Paste your HTML on the left and your email shows here.</p>
            )}
          </div>
        </section>
      </div>
      {ghost ? <span aria-hidden style={{ position: "fixed", left: ghost.x + 12, top: ghost.y + 12, zIndex: 100, pointerEvents: "none", ...btn, background: "var(--ed-cta)", color: "var(--ed-on-brand)", border: 0, boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}>{ghost.label}</span> : null}
      <style>{`@media (max-width: 860px){.plx-emed{grid-template-columns:1fr !important;grid-template-rows:minmax(0,1fr) minmax(0,1fr)}}`}</style>
    </div>
  );
}
