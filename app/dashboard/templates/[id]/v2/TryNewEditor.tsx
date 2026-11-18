"use client";

import { useEffect, useMemo, useState } from "react";
import { compilePageToHtml } from "@charisol/plexo-sdk/v2/compile";

import { convertV1ToV2, describeConversion, type ConversionResult } from "@/lib/v2/convertV1";
import { tryNewEditorKey } from "./logic";

// A classic page's way over to the new editor: a calm, dismissible banner, then a dialog that says
// in plain words what will happen, shows the converted page (and anything that will look different
// or can't come along) BEFORE anything changes, and only then moves it. The page can go back from
// its Page settings.

function remembered(templateId: string): boolean {
  try {
    return localStorage.getItem(tryNewEditorKey(templateId)) === "1";
  } catch {
    return false;
  }
}

export function TryNewEditorBanner({ templateId, onTry }: { templateId: string; onTry: () => void }) {
  // Starts hidden so a dismissed banner never flashes on load.
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(remembered(templateId)), [templateId]);
  if (hidden) return null;
  return (
    <div
      role="region"
      aria-label="New editor"
      style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0.5rem 1rem", background: "color-mix(in srgb, var(--brand) 8%, transparent)", borderBottom: "1px solid color-mix(in srgb, var(--brand) 20%, transparent)", fontSize: "0.8rem", color: "var(--ed-t-850)" }}
    >
      <span style={{ flex: 1, minWidth: 220 }}>Plexo has a new editor with more room to design. You can try it on this page and go back any time.</span>
      <button type="button" onClick={onTry} style={{ padding: "0.35rem 0.8rem", borderRadius: 8, border: "none", background: "var(--brand)", color: "var(--ed-on-brand)", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
        Try the new editor
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(tryNewEditorKey(templateId), "1");
          } catch {
            // Remembering is a convenience; the banner just closes for now.
          }
          setHidden(true);
        }}
        style={{ background: "none", border: "none", color: "var(--ed-t-550)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}

type Phase = { step: "loading" } | { step: "ready"; result: ConversionResult; previewHtml: string | null } | { step: "moving" } | { step: "error"; message: string };

export function TryNewEditorDialog(props: {
  templateId: string;
  templateName: string;
  slug: string | null;
  isHome: boolean;
  /** Saves the classic page and returns its design as it is right now. */
  getLatestDesign: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ step: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v1 = await props.getLatestDesign();
        const result = convertV1ToV2(v1, { id: props.templateId, name: props.templateName, slug: props.slug, isHome: props.isHome });
        let previewHtml: string | null = null;
        if (result.ok) {
          try {
            previewHtml = compilePageToHtml(result.design.pages[0], { runtime: "none", title: props.templateName, designSystem: result.design.designSystem }).document;
          } catch {
            previewHtml = null;
          }
        }
        if (!cancelled) setPhase({ step: "ready", result, previewHtml });
      } catch (err) {
        if (!cancelled) setPhase({ step: "error", message: err instanceof Error ? err.message : "Couldn't get this page ready to move." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notes = useMemo(() => (phase.step === "ready" && phase.result.ok ? describeConversion(phase.result.fidelity, phase.result.warnings) : null), [phase]);

  const move = async () => {
    setPhase({ step: "moving" });
    try {
      const res = await fetch(`/api/templates/${props.templateId}/convert-to-v2`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't move this page.");
      // Opens fresh, as a new-editor page.
      window.location.assign(`/dashboard/templates/${props.templateId}`);
    } catch (err) {
      setPhase({ step: "error", message: err instanceof Error ? err.message : "Couldn't move this page." });
    }
  };

  const ready = phase.step === "ready" && phase.result.ok ? phase : null;
  const blocked = phase.step === "ready" && !phase.result.ok ? phase.result : null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="try-v2-title" style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "var(--ed-scrim)", backdropFilter: "blur(8px)", padding: "1rem" }}>
      <div style={{ width: "min(960px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "var(--ed-panel)", color: "var(--ed-text)", border: "1px solid var(--ed-w-080)", borderRadius: 16, padding: "1.5rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
        <h2 id="try-v2-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>Try the new editor on this page</h2>
        <p style={{ margin: "0.5rem 0 1rem", fontSize: "0.85rem", lineHeight: 1.55, color: "var(--ed-t-700)" }}>
          We&rsquo;ll move this page into Plexo&rsquo;s new editor, where you can place things anywhere and tune each screen size. Here&rsquo;s what it will look like first. Nothing changes until you say so, your live site stays as it is until you publish, and you can go back to the classic editor from Page settings.
        </p>

        {phase.step === "loading" && <p style={{ fontSize: "0.85rem", color: "var(--ed-t-600)" }}>Getting your page ready to preview…</p>}
        {phase.step === "moving" && <p style={{ fontSize: "0.85rem", color: "var(--ed-t-600)" }}>Moving your page…</p>}
        {phase.step === "error" && <p role="alert" style={{ fontSize: "0.85rem", color: "var(--ed-danger)" }}>{phase.message}</p>}
        {blocked && !blocked.ok && <p role="alert" style={{ fontSize: "0.85rem", color: "var(--ed-danger)" }}>{blocked.error}</p>}

        {ready && ready.result.ok && notes && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
            <div>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 700 }}>{notes.headline}</p>
              {notes.differs.length > 0 && (
                <Checklist title="These will look slightly different" items={notes.differs} tone="amber" />
              )}
              {notes.missing.length > 0 && (
                <Checklist title="These blocks can't move over yet" items={notes.missing} tone="red" extra="You can add them again in the new editor." />
              )}
              {notes.differs.length === 0 && notes.missing.length === 0 && <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ed-success)" }}>No differences to report.</p>}
            </div>
            <div style={{ minHeight: 260 }}>
              {ready.previewHtml ? (
                <iframe title="Preview of this page in the new editor" sandbox="" srcDoc={ready.previewHtml} style={{ width: "100%", height: 360, border: "1px solid var(--ed-w-120)", borderRadius: 10, background: "#fff" }} />
              ) : (
                <p style={{ fontSize: "0.8rem", color: "var(--ed-t-550)" }}>A preview isn&rsquo;t available for this page, but it can still move over.</p>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button type="button" onClick={props.onClose} disabled={phase.step === "moving"} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid var(--ed-w-120)", background: "transparent", color: "var(--ed-t-800)", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            Not now
          </button>
          <button type="button" onClick={() => void move()} disabled={!ready} style={{ padding: "0.6rem 1.3rem", borderRadius: 9, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : 0.5, fontWeight: 700, fontFamily: "inherit" }}>
            {phase.step === "moving" ? "Moving…" : "Move this page"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Checklist({ title, items, tone, extra }: { title: string; items: string[]; tone: "amber" | "red"; extra?: string }) {
  const color = tone === "amber" ? "var(--ed-warning)" : "var(--ed-danger)";
  return (
    <div style={{ margin: "0.75rem 0" }}>
      <p style={{ margin: "0 0 0.3rem", fontSize: "0.78rem", fontWeight: 700, color }}>{title}</p>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.78rem", lineHeight: 1.5, color: "var(--ed-t-750)" }}>
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {extra && <p style={{ margin: "0.3rem 0 0", fontSize: "0.74rem", color: "var(--ed-t-500)" }}>{extra}</p>}
    </div>
  );
}
