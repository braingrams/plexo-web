"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

export type VersionTarget = { id: string; label: string; isDefault: boolean };
export type VersionOfferData = { versionId: string; label: string; whatsNew: string[]; remindAfterDays: number };
export type VersionUiData = { currentLabel: string; targets: VersionTarget[]; offer: VersionOfferData | null };

type Ctx = { targets: VersionTarget[]; request: (id: string) => void };
const VersionCtx = createContext<Ctx>({ targets: [], request: () => {} });

/** What the account menu / Settings can offer this person (empty when they can't switch). */
export function useVersionSwitch(): Ctx {
  return useContext(VersionCtx);
}

/** Wording for a switch: "Switch back to Version 1" / "Switch to Version 2". */
export function switchLabel(t: VersionTarget): string {
  return t.isDefault ? `Switch back to ${t.label}` : `Switch to ${t.label}`;
}

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wraps a dashboard shell (classic or new): provides the switch action to menus and Settings,
 * the plain confirmation, and the "Try Plexo Version 2" offer shown once on arrival. Self-contained
 * (inline styles, theme variables with fallbacks) so it looks right in either shell.
 */
export function VersionProvider({ data, children }: { data: VersionUiData; children: React.ReactNode }) {
  const [confirm, setConfirm] = useState<VersionTarget | null>(null);
  const [offer, setOffer] = useState<VersionOfferData | null>(data.offer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback((id: string) => {
    const t = data.targets.find((x) => x.id === id);
    if (t) {
      setError(null);
      setConfirm(t);
    }
  }, [data.targets]);

  const switchTo = async (id: string) => {
    setBusy(true);
    setError(null);
    const ok = await post("/api/dashboard-version", { to: id });
    if (ok) {
      // A full load: the other dashboard has its own frame, theme and first-run steps.
      window.location.assign("/dashboard");
      return;
    }
    setBusy(false);
    setError("We couldn't switch just now. Nothing has changed, so please try again.");
  };

  const answer = async (action: "later" | "never") => {
    const o = offer;
    setOffer(null);
    if (o) await post("/api/dashboard-version/offer", { versionId: o.versionId, action });
  };

  const value = useMemo(() => ({ targets: data.targets, request }), [data.targets, request]);
  const offerTarget = offer ? { id: offer.versionId, label: offer.label, isDefault: false } : null;

  return (
    <VersionCtx.Provider value={value}>
      {children}
      {confirm ? (
        <Dialog
          title={confirm.isDefault ? `Switch back to ${confirm.label}?` : `Switch to ${confirm.label}?`}
          onClose={() => !busy && setConfirm(null)}
          actions={
            <>
              <button type="button" style={btn(false)} onClick={() => setConfirm(null)} disabled={busy}>
                Stay where I am
              </button>
              <button type="button" style={btn(true)} onClick={() => switchTo(confirm.id)} disabled={busy}>
                {busy ? "Switching…" : "Yes, switch"}
              </button>
            </>
          }
        >
          <p style={para}>
            Your sites, pages, orders and everything else you&apos;ve made stay exactly as they are. Only how Plexo looks changes.
            {confirm.isDefault ? " You can switch to Version 2 again any time from the account menu." : " You can switch back any time from the account menu."}
          </p>
          {error ? <p role="alert" style={{ ...para, color: "var(--plx-danger, #f87171)" }}>{error}</p> : null}
        </Dialog>
      ) : null}
      {offer && offerTarget && !confirm ? (
        <Dialog
          title={`Try Plexo ${offer.label}`}
          onClose={() => answer("later")}
          actions={
            <>
              <button type="button" style={btn(false)} onClick={() => answer("later")} disabled={busy}>
                Maybe later
              </button>
              <button type="button" style={btn(true)} onClick={() => switchTo(offerTarget.id)} disabled={busy}>
                {busy ? "Switching…" : "Switch now"}
              </button>
            </>
          }
          footer={
            <button type="button" style={linkBtn} onClick={() => answer("never")}>
              Don&apos;t ask again
            </button>
          }
        >
          <p style={para}>{offer.label} is ready for you. Here&apos;s what&apos;s new:</p>
          {offer.whatsNew.length > 0 ? (
            <ul style={{ margin: "0 0 12px", padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
              {offer.whatsNew.map((b) => (
                <li key={b} style={{ ...para, margin: 0, display: "flex", gap: 10 }}>
                  <span aria-hidden style={{ color: "var(--plx-brand, #2563eb)", fontWeight: 900 }}>
                    ✓
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p style={{ ...para, color: "var(--plx-muted, #9aa0ad)", fontSize: 14 }}>Everything you&apos;ve made comes with you, and you can switch back any time.</p>
          {error ? <p role="alert" style={{ ...para, color: "var(--plx-danger, #f87171)" }}>{error}</p> : null}
        </Dialog>
      ) : null}
    </VersionCtx.Provider>
  );
}

const para: React.CSSProperties = { margin: "0 0 12px", fontSize: 16, lineHeight: 1.5, color: "var(--plx-text, #e8eaf0)" };
const btn = (primary: boolean): React.CSSProperties => ({
  minHeight: 44,
  padding: "0 20px",
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  border: primary ? "none" : "1px solid var(--plx-border-strong, #3a3f4d)",
  background: primary ? "var(--plx-brand, #2563eb)" : "transparent",
  color: primary ? "var(--plx-on-brand, #fff)" : "var(--plx-text, #e8eaf0)",
});
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: "8px 4px", fontSize: 14, color: "var(--plx-muted, #9aa0ad)", textDecoration: "underline", cursor: "pointer" };

function Dialog({ title, children, actions, footer, onClose }: { title: string; children: React.ReactNode; actions: React.ReactNode; footer?: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(8,9,14,.62)" }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width: "100%", maxWidth: 460, borderRadius: 20, padding: "28px 28px 20px", background: "var(--plx-surface, #171a22)", border: "1px solid var(--plx-border, #2a2e3a)", boxShadow: "0 24px 60px rgba(0,0,0,.45)", color: "var(--plx-text, #e8eaf0)" }}
      >
        <h2 id={titleId} style={{ margin: "0 0 14px", fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>
          {title}
        </h2>
        {children}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>{actions}</div>
        {footer ? <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>{footer}</div> : null}
      </div>
    </div>
  );
}
