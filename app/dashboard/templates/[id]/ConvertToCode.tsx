"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { afterConvertHref, sourceChoices, type ConvertNotes } from "@/lib/editorModes/convertToCode";
import type { EditorViewName } from "@/lib/editorModes/switchCheck";
import { EditModeSwitch } from "./EditModeSwitch";

type Source = "working" | "live";
type Preview = { html: string; hasUnpublishedChanges: boolean; isLive: boolean; notes: ConvertNotes };

const BLOCK_HINTS: Partial<Record<EditorViewName, string>> = {
  design: "You are changing your page with blocks",
  code: "Switch to code: your page becomes editable code. It looks the same, and we keep a backup you can restore.",
  text: "Switch to text: your page becomes editable code first (it looks the same, and we keep a backup), then you change the words.",
};

/**
 * Design | Code | Text for a page built with blocks. Design is where you are; Code and Text turn the page into editable code
 * first (after saying so in plain words), then open that view.
 */
export function BlockModeSwitch({ onPick }: { onPick: (view: "code" | "text") => void }) {
  return (
    <EditModeSwitch
      value="design"
      hints={BLOCK_HINTS}
      onChange={(v) => {
        if (v !== "design") onPick(v);
      }}
    />
  );
}

const card: React.CSSProperties = { background: "var(--ed-panel)", color: "var(--ed-text)", border: "1px solid var(--ed-w-080)", borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" };
const ghostBtn: React.CSSProperties = { padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid var(--ed-w-120)", background: "transparent", color: "var(--ed-t-800)", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" };

/**
 * Says in plain words what turning a block page into code does, shows the page exactly as it will be, lets the owner pick which
 * version to keep if they have unpublished changes, and only then does it. The server saves a backup first.
 */
export function ConvertToCodeDialog(props: {
  templateId: string;
  templateName: string;
  /** Which view the owner asked for; they land in it afterwards. */
  target: "code" | "text";
  /** Saves what is on the canvas, so what we turn into code is what the owner sees. */
  saveFirst: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("working");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const savedRef = useRef(false);

  const load = useCallback(
    async (which: Source) => {
      setPhase("loading");
      setMessage(null);
      try {
        if (!savedRef.current) {
          await props.saveFirst();
          savedRef.current = true;
        }
        const res = await fetch(`/api/templates/${props.templateId}/convert-to-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview: true, source: which }) });
        const data = (await res.json().catch(() => ({}))) as Partial<Preview> & { error?: string };
        if (!res.ok || typeof data.html !== "string") throw new Error(data.error ?? "We couldn't get this page ready. Nothing was changed.");
        setPreview(data as Preview);
        setPhase("ready");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "We couldn't get this page ready. Nothing was changed.");
        setPhase("error");
      }
    },
    // saveFirst is the editor's own function; it only needs to run once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.templateId],
  );

  useEffect(() => {
    void load("working");
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "working") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, props]);

  const choices = preview ? sourceChoices(preview) : { ask: false, options: [] };

  async function convert() {
    setPhase("working");
    setMessage(null);
    try {
      const res = await fetch(`/api/templates/${props.templateId}/convert-to-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: choices.ask ? source : "working" }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "We couldn't turn this page into code. Nothing was changed.");
      // Opens fresh, as a page of code, in the view that was asked for.
      window.location.assign(afterConvertHref(props.templateId, props.target));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "We couldn't turn this page into code. Nothing was changed.");
      setPhase("error");
    }
  }

  const busy = phase === "loading" || phase === "working";
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="convert-code-title" style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "var(--ed-scrim)", backdropFilter: "blur(8px)", padding: "1rem" }}>
      <div style={{ ...card, width: "min(960px, 100%)", maxHeight: "92vh", overflowY: "auto", padding: "clamp(1rem, 4vw, 1.5rem)" }}>
        <h2 id="convert-code-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>
          {props.target === "text" ? "Change the words on this page" : "Edit this page's code"}
        </h2>
        <p style={{ margin: "0.5rem 0 1rem", fontSize: "0.9rem", lineHeight: 1.55, color: "var(--ed-t-700)" }}>
          This turns your page into editable code. It will look the same. We keep a backup you can restore.
        </p>

        {phase === "loading" && <p role="status" style={{ fontSize: "0.85rem", color: "var(--ed-t-600)" }}>Getting your page ready…</p>}
        {phase === "working" && <p role="status" style={{ fontSize: "0.85rem", color: "var(--ed-t-600)" }}>Turning your page into code…</p>}
        {message && <p role="alert" style={{ fontSize: "0.85rem", color: "var(--ed-danger)", lineHeight: 1.5 }}>{message}</p>}

        {preview && (phase === "ready" || phase === "working" || (phase === "error" && preview)) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.25rem" }}>
            <div>
              <Section title="What comes along" items={preview.notes.copied} tone="ok" />
              {preview.notes.heads.length > 0 && <Section title="Good to know" items={preview.notes.heads} tone="note" />}
              {choices.ask && (
                <fieldset disabled={busy} style={{ margin: "0.9rem 0 0", padding: 0, border: "none" }}>
                  <legend style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>You have changes you haven&rsquo;t published. Which one should become the code?</legend>
                  {choices.options.map((o) => (
                    <label key={o.value} style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start", padding: "0.5rem 0.6rem", marginBottom: "0.4rem", borderRadius: 10, border: `1px solid ${source === o.value ? "var(--brand)" : "var(--ed-w-100)"}`, cursor: "pointer", fontSize: "0.8rem", lineHeight: 1.45 }}>
                      <input
                        type="radio"
                        name="convert-source"
                        checked={source === o.value}
                        onChange={() => {
                          setSource(o.value);
                          void load(o.value);
                        }}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <strong>{o.label}</strong>
                        <br />
                        <span style={{ color: "var(--ed-t-600)" }}>{o.help}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <p style={{ margin: "0.9rem 0 0", fontSize: "0.78rem", color: "var(--ed-t-600)", lineHeight: 1.5 }}>
                Changed your mind later? Use <strong>Go back to blocks</strong> at the top of the page.
              </p>
            </div>
            <div style={{ minHeight: 240 }}>
              <p style={{ margin: "0 0 0.4rem", fontSize: "0.78rem", fontWeight: 700 }}>Your page, as it will be</p>
              <iframe title="Your page as code" sandbox="" srcDoc={preview.html} style={{ width: "100%", height: 340, border: "1px solid var(--ed-w-120)", borderRadius: 10, background: "#fff" }} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: "1.25rem", flexWrap: "wrap" }}>
          <button type="button" onClick={props.onClose} disabled={phase === "working"} style={ghostBtn}>
            Not now
          </button>
          {phase === "error" && !preview ? (
            <button type="button" onClick={() => void load(source)} style={{ ...ghostBtn, color: "var(--ed-text)" }}>
              Try again
            </button>
          ) : (
            <button type="button" onClick={() => void convert()} disabled={!preview || busy} style={{ padding: "0.6rem 1.3rem", borderRadius: 9, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", cursor: preview && !busy ? "pointer" : "not-allowed", opacity: preview && !busy ? 1 : 0.5, fontWeight: 700, fontFamily: "inherit" }}>
              {phase === "working" ? "Turning into code…" : "Turn into code"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "note" }) {
  return (
    <div style={{ margin: "0 0 0.75rem" }}>
      <p style={{ margin: "0 0 0.3rem", fontSize: "0.8rem", fontWeight: 700, color: tone === "ok" ? "var(--ed-success)" : "var(--ed-warning)" }}>{title}</p>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--ed-t-750)" }}>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Shown on a page that started as blocks: the way back. It says what is lost (anything changed in the code since) before it asks,
 * then restores the saved block version.
 */
export function BackToBlocks({ templateId }: { templateId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function restore() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/restore-blocks`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "We couldn't go back to blocks. Your page is unchanged.");
      window.location.assign(`/dashboard/templates/${templateId}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "We couldn't go back to blocks. Your page is unchanged.");
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ padding: "0.4rem 0.85rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600, background: "none", border: "1px solid var(--ed-w-120)", color: "var(--ed-t-800)", cursor: "pointer", whiteSpace: "nowrap" }} title="Put this page back as blocks, the way it was before you turned it into code">
        Go back to blocks
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="back-blocks-title" style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "var(--ed-scrim)", backdropFilter: "blur(8px)", padding: "1rem" }}>
          <div style={{ ...card, width: "min(460px, 100%)", padding: "clamp(1rem, 4vw, 1.5rem)" }}>
            <h2 id="back-blocks-title" style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>Go back to blocks?</h2>
            <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem", lineHeight: 1.55, color: "var(--ed-t-700)" }}>
              Your page goes back to the blocks it had before you turned it into code, including any changes you hadn&rsquo;t published then. <strong>Anything you have changed in the code since will be lost.</strong>
            </p>
            {message && <p role="alert" style={{ fontSize: "0.85rem", color: "var(--ed-danger)" }}>{message}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: "1.1rem", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} style={ghostBtn}>
                Stay with code
              </button>
              <button type="button" onClick={() => void restore()} disabled={busy} style={{ padding: "0.6rem 1.2rem", borderRadius: 9, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", cursor: busy ? "wait" : "pointer", fontWeight: 700, fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                {busy ? "Going back…" : "Go back to blocks"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
