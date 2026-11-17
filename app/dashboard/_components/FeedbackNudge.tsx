"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useStruggleDetector } from "@/lib/struggle/useStruggleDetector";
import { OPEN_FEEDBACK_EVENT } from "@/lib/struggle/events";
import type { StruggleSignal } from "@/lib/struggle/detector";

const MAX_MESSAGE = 2000;
const MAX_SHOT = 1_500_000;
const CATEGORIES = [
  { id: "broke", label: "Something broke" },
  { id: "confusing", label: "Confusing" },
  { id: "missing", label: "Missing feature" },
  { id: "other", label: "Other" },
] as const;

const SIGNAL_WORDS: Record<StruggleSignal, string> = {
  rage_click: "repeated clicking",
  dead_click: "clicks that did nothing",
  failed_requests: "a few failed requests",
  repeated_error: "a repeated error message",
  js_error: "a page error",
  boundary: "a page that crashed",
  stuck: "a step taking a while",
  nav_loop: "going back and forth",
};

function browserName(): string {
  const ua = navigator.userAgent;
  const pick = (re: RegExp, name: string) => { const m = re.exec(ua); return m ? `${name} ${m[1]}` : null; };
  return pick(/Edg\/(\d+)/, "Edge") ?? pick(/Firefox\/(\d+)/, "Firefox") ?? pick(/Chrome\/(\d+)/, "Chrome") ?? pick(/Version\/(\d+).*Safari/, "Safari") ?? "Browser";
}

/**
 * Calm, self-contained "Having an issue? Tell us" card + short form. Mount once in
 * app/dashboard/layout.tsx. Skin-aware: reads --color-action-primary / --color-bg-surface /
 * --color-text-primary when a shell defines them, else the classic theme variables.
 * Anything can open the form with openFeedback() from lib/struggle/events.
 */
export function FeedbackNudge({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { visible, signals, hide, optOut, detectorSignals } = useStruggleDetector(userId);
  const [formOpen, setFormOpen] = useState(false);
  const [fromNudge, setFromNudge] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [shot, setShot] = useState<{ name: string; dataUrl: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sentSignals, setSentSignals] = useState<StruggleSignal[]>([]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = useCallback((nudge: boolean) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setFromNudge(nudge);
    setSentSignals(detectorSignals());
    setFormOpen(true);
  }, [detectorSignals]);

  useEffect(() => {
    const h = () => open(false);
    window.addEventListener(OPEN_FEEDBACK_EVENT, h);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, h);
  }, [open]);

  const close = useCallback(() => {
    setFormOpen(false);
    if (done) { setMessage(""); setCategory(null); setShot(null); setDone(false); }
    setError(null);
    setTimeout(() => returnFocus.current?.focus?.(), 0);
  }, [done]);

  // Focus into the dialog, keep Tab inside it, Escape closes.
  useEffect(() => {
    if (!formOpen) return;
    const root = dialogRef.current;
    root?.querySelector<HTMLElement>("textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); return; }
      if (e.key !== "Tab" || !root) return;
      const f = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, input, [href]")].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [formOpen, close]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setError("Please attach a PNG, JPG or WebP image."); return; }
    if (f.size > MAX_SHOT * 0.74) { setError("That picture is a little too big. Please try one under 1 MB."); return; }
    const r = new FileReader();
    r.onload = () => { setError(null); setShot({ name: f.name, dataUrl: String(r.result) }); };
    r.onerror = () => setError("We could not open that picture. Please try another.");
    r.readAsDataURL(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) { setError("Please tell us a little about what you were trying to do."); return; }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(), category: category ?? undefined, type: fromNudge ? "struggle" : "feedback",
          signals: sentSignals, pageUrl: pathname, browser: browserName(), screenshot: shot?.dataUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "We could not send that just now.");
      setDone(true);
    } catch (err) {
      const offline = err instanceof TypeError;
      setError(offline ? "We could not reach Plexo. Check your connection and try again. Your message is still here." : err instanceof Error ? err.message : "We could not send that just now. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const noticed = sentSignals.map((s) => SIGNAL_WORDS[s]);

  return (
    <div data-feedback-root>
      <style>{CSS}</style>

      {visible && !formOpen && (
        <div className="fbn-card" role="status" aria-live="polite">
          <div className="fbn-icon" aria-hidden="true"><IconChat size={18} /></div>
          <div className="fbn-body">
            <p className="fbn-title">Having an issue?</p>
            <p className="fbn-sub">Tell us. We read every message.</p>
            <div className="fbn-actions">
              <button type="button" className="fbn-btn" onClick={() => { hide(); open(true); }}>Give us feedback</button>
              <button type="button" className="fbn-link" onClick={optOut}>Don&apos;t show again</button>
            </div>
          </div>
          <button type="button" className="fbn-x" onClick={hide} aria-label="Dismiss"><IconX /></button>
        </div>
      )}

      {formOpen && (
        <div className="fbn-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div ref={dialogRef} className="fbn-dialog" role="dialog" aria-modal="true" aria-labelledby="fbn-h">
            <button type="button" className="fbn-x" onClick={close} aria-label="Close"><IconX /></button>
            {done ? (
              <div className="fbn-done">
                <div className="fbn-tick" aria-hidden="true"><IconCheck /></div>
                <h2 id="fbn-h" className="fbn-h">Thank you, we got it</h2>
                <p className="fbn-sub">A real person on the team will read this. If it is something we can fix, we will.</p>
                <button type="button" className="fbn-btn" onClick={close}>Back to Plexo</button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <h2 id="fbn-h" className="fbn-h">{fromNudge ? "Sorry that was hard. What happened?" : "Tell us what you think"}</h2>
                <label className="fbn-label" htmlFor="fbn-msg">What were you trying to do?</label>
                <textarea
                  id="fbn-msg" className="fbn-field" rows={4} maxLength={MAX_MESSAGE} value={message}
                  onChange={(e) => setMessage(e.target.value)} placeholder="For example: I was trying to publish my page, but nothing happened."
                />
                <div className="fbn-chips" role="group" aria-label="What kind of feedback (optional)">
                  {CATEGORIES.map((c) => (
                    <button key={c.id} type="button" aria-pressed={category === c.id} className="fbn-chip" onClick={() => setCategory(category === c.id ? null : c.id)}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="fbn-attach">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} hidden />
                  {shot ? (
                    <span className="fbn-file">{shot.name}<button type="button" className="fbn-link" onClick={() => setShot(null)}>Remove</button></span>
                  ) : (
                    <button type="button" className="fbn-link" onClick={() => fileRef.current?.click()}>Add a screenshot (optional)</button>
                  )}
                </div>
                <p className="fbn-send">
                  <strong>What we will send:</strong> your message, this page ({pathname}), your browser ({typeof navigator === "undefined" ? "" : browserName()}) and your account
                  {noticed.length ? `, plus what we noticed (${noticed.join(", ")})` : ""}. Nothing else, and no recording of your screen.
                </p>
                {error && <p className="fbn-err" role="alert">{error}</p>}
                <div className="fbn-row">
                  <button type="button" className="fbn-ghost" onClick={close}>Cancel</button>
                  <button type="submit" className="fbn-btn" disabled={sending}>{sending ? "Sending…" : "Send"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconChat({ size = 18 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
}
function IconX() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}
function IconCheck() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>);
}

const CSS = `
[data-feedback-root]{
  --fb-action:var(--color-action-primary,var(--brand,#7c5cff));
  --fb-surface:var(--color-bg-surface,var(--bg-1,var(--plx-surface, #0d1324)));
  --fb-field:var(--color-bg-subtle,var(--bg-2,color-mix(in srgb, var(--plx-text, #fff) 5%, transparent)));
  --fb-text:var(--color-text-primary,var(--text-main,var(--plx-text, #f0f2ff)));
  --fb-muted:var(--color-text-secondary,var(--text-muted,#8b92b3));
  --fb-border:var(--color-border-default,var(--surface-border,color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)));
  --fb-danger:var(--color-danger,#e5484d);
  font-family:var(--font-body,inherit);color:var(--fb-text);
}
.fbn-card{position:fixed;right:20px;bottom:20px;z-index:90;display:flex;gap:12px;align-items:flex-start;width:min(340px,calc(100vw - 32px));
  padding:14px 36px 14px 14px;background:var(--fb-surface);border:1px solid var(--fb-border);border-radius:16px;
  box-shadow:0 12px 36px rgba(0,0,0,.28);animation:fbn-in .35s cubic-bezier(.16,1,.3,1)}
.fbn-icon{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--fb-action);background:color-mix(in srgb,var(--fb-action) 14%,transparent)}
.fbn-title{margin:0;font-weight:700;font-size:.95rem}
.fbn-sub{margin:2px 0 0;font-size:.84rem;color:var(--fb-muted);line-height:1.45}
.fbn-actions{display:flex;align-items:center;gap:14px;margin-top:10px;flex-wrap:wrap}
.fbn-btn{background:var(--fb-action);color:#fff;border:0;border-radius:10px;padding:8px 14px;font:inherit;font-size:.85rem;font-weight:600;cursor:pointer}
.fbn-btn:disabled{opacity:.6;cursor:progress}
.fbn-ghost{background:none;border:1px solid var(--fb-border);color:var(--fb-text);border-radius:10px;padding:8px 14px;font:inherit;font-size:.85rem;cursor:pointer}
.fbn-link{background:none;border:0;padding:0;color:var(--fb-muted);font:inherit;font-size:.8rem;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.fbn-x{position:absolute;top:10px;right:10px;background:none;border:0;color:var(--fb-muted);cursor:pointer;padding:6px;border-radius:8px;display:grid;place-items:center}
.fbn-x:hover{color:var(--fb-text)}
.fbn-scrim{position:fixed;inset:0;z-index:120;background:var(--plx-overlay, rgba(3,7,18,.55));display:grid;place-items:center;padding:16px;animation:fbn-fade .2s ease}
.fbn-dialog{position:relative;width:min(480px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--fb-surface);border:1px solid var(--fb-border);border-radius:18px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.4)}
.fbn-h{margin:0 28px 14px 0;font-size:1.15rem;font-weight:800;font-family:var(--font-heading,inherit)}
.fbn-label{display:block;font-size:.84rem;font-weight:600;margin-bottom:6px}
.fbn-field{width:100%;box-sizing:border-box;background:var(--fb-field);color:var(--fb-text);border:1px solid var(--fb-border);border-radius:10px;padding:10px 12px;font:inherit;font-size:.9rem;resize:vertical}
.fbn-field:focus-visible,.fbn-chip:focus-visible,.fbn-btn:focus-visible,.fbn-ghost:focus-visible,.fbn-link:focus-visible,.fbn-x:focus-visible{outline:2px solid var(--fb-action);outline-offset:2px}
.fbn-chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.fbn-chip{background:none;border:1px solid var(--fb-border);color:var(--fb-text);border-radius:999px;padding:6px 12px;font:inherit;font-size:.82rem;cursor:pointer}
.fbn-chip[aria-pressed="true"]{background:color-mix(in srgb,var(--fb-action) 16%,transparent);border-color:var(--fb-action)}
.fbn-attach{margin-bottom:12px}.fbn-file{display:inline-flex;gap:10px;align-items:center;font-size:.82rem;color:var(--fb-muted)}
.fbn-send{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:var(--fb-field);color:var(--fb-muted);font-size:.78rem;line-height:1.5}
.fbn-send strong{color:var(--fb-text)}
.fbn-err{margin:0 0 12px;color:var(--fb-danger);font-size:.84rem}
.fbn-row{display:flex;justify-content:flex-end;gap:8px}
.fbn-done{text-align:center;padding:12px 0 4px}.fbn-done .fbn-h{margin-right:0}.fbn-done .fbn-btn{margin-top:16px}
.fbn-tick{width:48px;height:48px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;color:var(--fb-action);background:color-mix(in srgb,var(--fb-action) 14%,transparent)}
@keyframes fbn-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes fbn-fade{from{opacity:0}to{opacity:1}}
@media (max-width:640px){
  .fbn-card{right:0;left:0;bottom:0;width:auto;border-radius:18px 18px 0 0;padding-bottom:calc(14px + env(safe-area-inset-bottom));animation-name:fbn-up}
  .fbn-scrim{align-items:end;padding:0}.fbn-dialog{border-radius:18px 18px 0 0;width:100%;max-height:92dvh}
}
@keyframes fbn-up{from{transform:translateY(100%)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.fbn-card,.fbn-scrim{animation:none}}
`;
