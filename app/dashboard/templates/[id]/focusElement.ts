/**
 * Scrolls to one element in an editor and highlights it, for "Open the editor" links from Site health (?focus=<id>).
 * The editor may still be loading when this is called, so it looks again every quarter second for up to ten seconds, then gives up quietly
 * (the editor is simply open as usual). The highlight is an outline that pulses and fades after a few seconds, and a small note
 * says what the owner is looking at. Returns a function that stops everything (for effect clean-up).
 */

const STYLE_ID = "plx-health-focus-style";
const CLASS = "plx-health-focus";

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `.${CLASS}{outline:3px solid var(--ed-amber, currentColor) !important;outline-offset:3px !important;border-radius:4px;animation:plx-health-pulse 1.1s ease-in-out 4 !important;scroll-margin:120px}@keyframes plx-health-pulse{0%,100%{outline-offset:3px}50%{outline-offset:7px}}@media (prefers-reduced-motion:reduce){.${CLASS}{animation:none !important}}.plx-health-note{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;background:var(--ed-text, #000);color:var(--ed-bg, #fff);font:600 13px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:min(92vw,420px)}`;
  doc.head.appendChild(style);
}

export const FOCUS_NOTE = "This is the spot your site check pointed to.";

export function focusElementWhenReady(find: () => Element | null, opts: { doc?: Document; note?: string; timeoutMs?: number } = {}): () => void {
  const doc = opts.doc ?? document;
  let stopped = false;
  let note: HTMLElement | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const started = Date.now();
  const tick = () => {
    if (stopped) return;
    const el = find();
    if (!el) {
      if (Date.now() - started < (opts.timeoutMs ?? 10_000)) timers.push(setTimeout(tick, 250));
      return;
    }
    ensureStyle(doc);
    (el as HTMLElement).scrollIntoView?.({ behavior: "smooth", block: "center" });
    el.classList.add(CLASS);
    note = doc.createElement("div");
    note.className = "plx-health-note";
    note.setAttribute("role", "status");
    note.textContent = opts.note ?? FOCUS_NOTE;
    doc.body.appendChild(note);
    timers.push(setTimeout(() => el.classList.remove(CLASS), 6000));
    timers.push(setTimeout(() => note?.remove(), 7000));
  };
  tick();
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
    note?.remove();
  };
}
