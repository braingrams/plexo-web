"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Loader2, MinusCircle, Undo2, X } from "lucide-react";
import { SolOutOfCredits } from "./sol/SolTopUp";
import { askSolStreaming } from "@/lib/ai/clientAssist";
import { isOutOfCreditsReply } from "@/lib/ai/requestErrors";
import { creditNote, MAX_PAGES_PER_RUN, runOnPages, summarizeRun, undoableStates, type PageContext, type PageRunState } from "@/lib/ai/multiPageRun";
import { buildPageChoices, type PageChoice, type PickablePage } from "@/lib/dashboardV3/pickPage";

// "Ask SOL about several pages": tick the pages, say what you want once, and SOL changes each page in turn. Every changed page
// is saved as a draft (nothing goes live by itself) and the whole run can be undone with one button.

const ink = "var(--plx-text, var(--ed-text, #f4f5fb))";
const surface = "var(--plx-surface, var(--ed-panel, #15171f))";
const line = "color-mix(in srgb, currentColor 16%, transparent)";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/v1/ai/multi-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again in a moment.");
  return data;
}

type Estimate = { paidBy: string; total: number; balance: number | null; perPage: number[]; enough: boolean };

export function MultiPageSolDialog({ siteId, currentPageId, onClose, onChanged, beforeRun }: { siteId: string; currentPageId?: string; onClose: () => void; onChanged?: () => void; /** Runs just before SOL starts (the editor saves what is on screen so SOL reads the latest). */ beforeRun?: () => Promise<unknown> }) {
  const [choices, setChoices] = useState<PageChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(currentPageId ? [currentPageId] : []));
  const [question, setQuestion] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [stage, setStage] = useState<"setup" | "running" | "done">("setup");
  const [states, setStates] = useState<PageRunState[]>([]);
  const [undone, setUndone] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/templates/${siteId}/pages`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { rootId: string; pages: PickablePage[] }) => setChoices(buildPageChoices(d.pages, d.rootId)))
      .catch(() => setLoadError("We couldn't load your pages. Close this and try again."));
  }, [siteId]);

  const ids = useMemo(() => (choices ?? []).filter((c) => picked.has(c.id)).map((c) => c.id), [choices, picked]);
  useEffect(() => {
    setEstimate(null);
    if (!ids.length) return;
    const t = setTimeout(() => {
      call<Estimate>({ action: "estimate", pageIds: ids }).then(setEstimate).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [ids]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stage !== "running" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = choices !== null && picked.size === choices.length;
  const tooMany = ids.length > MAX_PAGES_PER_RUN;
  const canStart = ids.length > 0 && !tooMany && question.trim().length > 2;

  async function start() {
    if (!choices) return;
    const chosen = choices.filter((c) => picked.has(c.id)).map((c) => ({ pageId: c.id, name: c.label }));
    abort.current = new AbortController();
    setStage("running");
    await Promise.resolve(beforeRun?.()).catch(() => undefined);
    setUndone(false);
    const { parseSolReply } = await import("@charisol/plexo-sdk/v2/compile");
    const out = await runOnPages({
      pages: chosen,
      question: question.trim(),
      signal: abort.current.signal,
      onProgress: setStates,
      deps: {
        loadPage: (pageId) => call<PageContext & { skipped?: string }>({ action: "page", pageId }),
        ask: ({ question: q, page, signal }) =>
          askSolStreaming(
            {
              question: `${q}\n\n(The owner asked for this on ${chosen.length} pages. Change only this page, "${page.name}", and say in one sentence what you changed.)`,
              context: { pageId: page.pageId, nodeName: page.name, design: page.design, catalog: page.catalog },
              history: [],
            },
            () => undefined,
            signal,
          ),
        parse: (reply) => parseSolReply(reply) as { text: string; commands: unknown[] | null; error?: string },
        apply: (pageId, commands) => call<{ saved: boolean; message: string; before: unknown }>({ action: "apply", pageId, commands }),
        isOutOfCredits: isOutOfCreditsReply,
      },
    });
    setStates(out);
    setStage("done");
    if (undoableStates(out).length) onChanged?.();
  }

  async function undoAll() {
    setUndoing(true);
    setUndoError(null);
    try {
      for (const s of undoableStates(states)) await call({ action: "undo", pageId: s.pageId, before: s.before ?? null });
      setUndone(true);
      onChanged?.();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "We couldn't undo everything. Open the pages to check them.");
    } finally {
      setUndoing(false);
    }
  }

  const outOfCredits = states.some((s) => s.status === "no-credits");
  const btn: React.CSSProperties = { minHeight: 44, padding: "0 18px", borderRadius: 12, font: "inherit", fontWeight: 700, cursor: "pointer", border: `1px solid ${line}`, background: "transparent", color: "inherit" };
  const primary: React.CSSProperties = { ...btn, border: "none", background: "var(--plx-brand, var(--brand, #7c5cff))", color: "var(--plx-on-brand, var(--ed-on-brand, #fff))" };

  return (
    <div role="presentation" onMouseDown={(e) => e.target === e.currentTarget && stage !== "running" && onClose()} style={{ position: "fixed", inset: 0, zIndex: 120, display: "grid", placeItems: "center", background: "rgba(8,10,16,.6)", backdropFilter: "blur(6px)", padding: 12 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="multi-sol-title" style={{ width: "min(94vw, 640px)", maxHeight: "92vh", overflowY: "auto", background: surface, color: ink, borderRadius: 18, border: `1px solid ${line}`, boxShadow: "0 24px 60px rgba(0,0,0,.45)", padding: 22, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 id="multi-sol-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, flex: 1 }}>Change several pages with SOL</h2>
          {stage !== "running" && <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn, width: 44, padding: 0, display: "grid", placeItems: "center", border: "none" }}><X size={18} aria-hidden /></button>}
        </div>

        {stage === "setup" && (
          <>
            <p style={{ margin: 0, opacity: 0.75, fontSize: "0.9rem" }}>Tick the pages, say what you want once, and SOL changes each page. Nothing goes live until you publish, and you can undo it all.</p>
            {loadError ? <p role="alert">{loadError}</p> : !choices ? <p role="status">Loading your pages…</p> : (
              <fieldset style={{ border: `1px solid ${line}`, borderRadius: 14, margin: 0, padding: 6, display: "grid", gap: 2, maxHeight: 260, overflowY: "auto" }}>
                <legend style={{ padding: "0 6px", fontSize: "0.8rem", opacity: 0.7 }}>Pages</legend>
                <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>
                  <input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(choices.map((c) => c.id)))} style={{ width: 20, height: 20 }} />
                  All pages ({choices.length})
                </label>
                {choices.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "0 10px", paddingLeft: 10 + c.depth * 18, cursor: "pointer", borderRadius: 10 }}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} style={{ width: 20, height: 20 }} />
                    <span style={{ fontWeight: 600 }}>{c.label}</span>
                    <span style={{ marginLeft: "auto", opacity: 0.55, fontSize: "0.8rem" }}>{c.isHome ? "Your homepage" : c.path}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              What should SOL do on these pages?
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="For example: make the wording friendlier and add our phone number to every page" style={{ font: "inherit", fontWeight: 400, padding: 12, borderRadius: 12, border: `1px solid ${line}`, background: "transparent", color: "inherit", resize: "vertical" }} />
            </label>
            {tooMany && <p role="alert" style={{ margin: 0, color: "var(--plx-danger, #ff8a8a)" }}>That's a lot of pages at once. Pick up to {MAX_PAGES_PER_RUN}, then do the rest in another round.</p>}
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.75, minHeight: 20 }} aria-live="polite">{ids.length ? `${ids.length} ${ids.length === 1 ? "page" : "pages"} picked. ` : "Pick at least one page. "}{creditNote(estimate)}</p>
            {estimate && !estimate.enough && estimate.paidBy === "plexo" && <SolOutOfCredits onDismiss={() => setEstimate({ ...estimate, enough: true })} />}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={btn} onClick={onClose}>Cancel</button>
              <button type="button" style={{ ...primary, opacity: canStart ? 1 : 0.5, cursor: canStart ? "pointer" : "default" }} disabled={!canStart} onClick={() => void start()}>
                Change {ids.length || ""} {ids.length === 1 ? "page" : "pages"}
              </button>
            </div>
          </>
        )}

        {stage !== "setup" && (
          <>
            <p style={{ margin: 0, fontWeight: 700 }} aria-live="polite">{stage === "running" ? `SOL is working through your pages (${states.filter((s) => s.status !== "waiting" && s.status !== "working").length} of ${states.length} done)` : undone ? "All changes were undone." : summarizeRun(states)}</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {states.map((s) => (
                <li key={s.pageId} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${line}`, borderRadius: 12 }}>
                  <span aria-hidden style={{ marginTop: 2, display: "grid", placeItems: "center" }}>
                    {s.status === "working" ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : s.status === "done" ? <Check size={18} /> : s.status === "failed" || s.status === "no-credits" ? <CircleAlert size={18} /> : <MinusCircle size={18} style={{ opacity: 0.6 }} />}
                  </span>
                  <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <strong>{s.name}</strong>
                    <span style={{ fontSize: "0.85rem", opacity: 0.8 }}>{undone && s.status === "done" ? "Put back how it was" : s.note}</span>
                    {s.said && !undone && s.status === "done" && <span style={{ fontSize: "0.82rem", opacity: 0.65 }}>{s.said}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {outOfCredits && <SolOutOfCredits onDismiss={() => undefined} />}
            {undoError && <p role="alert" style={{ margin: 0, color: "var(--plx-danger, #ff8a8a)" }}>{undoError}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              {stage === "running" ? (
                <button type="button" style={btn} onClick={() => abort.current?.abort()}>Stop after this page</button>
              ) : (
                <>
                  {undoableStates(states).length > 0 && !undone && (
                    <button type="button" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 8 }} disabled={undoing} onClick={() => void undoAll()}>
                      <Undo2 size={16} aria-hidden /> {undoing ? "Undoing…" : "Undo all changes"}
                    </button>
                  )}
                  <button type="button" style={primary} onClick={onClose}>Done</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
