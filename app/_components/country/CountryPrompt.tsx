"use client";

import { useEffect, useRef, useState } from "react";
import { CountrySelect } from "./CountrySelect";
import { T } from "./skin";

type State = { shouldAsk: boolean; guess: string | null };

/**
 * One friendly question for owners who haven't told us their country. Mount it once in the
 * dashboard layout; it asks nothing of anyone who already answered. It can't be closed or put
 * off: pricing depends on the answer, so they pick a country before carrying on. Self-contained
 * and skinned with CSS variables, so it fits both the classic dashboard and the new brand.
 */
export function CountryPrompt() {
  const [state, setState] = useState<State | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/profile/country", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { shouldAsk?: boolean; guess?: string | null } | null) => {
        if (!live || !d?.shouldAsk) return;
        setValue(d.guess ?? null);
        setState({ shouldAsk: true, guess: d.guess ?? null });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const open = !!state?.shouldAsk;

  // Keep keyboard focus inside the dialog, and give it back when it closes.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("input, button:not([disabled])")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  async function save() {
    if (!value) return setError("Please pick your country to continue.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/country", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: value }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "");
      setState(null);
      // Prices elsewhere on the page were worked out without it.
      window.dispatchEvent(new Event("plexo:country-saved"));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,7,15,0.66)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: T.font }}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="country-prompt-title"
        aria-describedby="country-prompt-desc"
        onKeyDown={(e) => {
          if (e.key === "Escape") e.preventDefault();
        }}
        style={{ width: "100%", maxWidth: 440, background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: "1.6rem", boxShadow: "0 30px 80px rgba(0,0,0,0.55)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }}
      >
        <div aria-hidden style={{ width: 44, height: 44, borderRadius: 14, background: T.action, color: T.onAction, display: "grid", placeItems: "center", marginBottom: "1rem" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
          </svg>
        </div>
        <h2 id="country-prompt-title" style={{ margin: 0, fontFamily: T.heading, fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.01em" }}>
          Which country are you in?
        </h2>
        <p id="country-prompt-desc" style={{ margin: "0.4rem 0 1.1rem", color: T.muted, fontSize: "0.92rem", lineHeight: 1.5 }}>
          Pick yours and your plans, prices and top-ups will show in your own currency. It only takes a second.
        </p>
        <CountrySelect value={value} onChange={(c) => { setValue(c); setError(null); }} autoFocus invalid={!!error} />
        {state?.guess && value === state.guess && <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: T.muted }}>We guessed this from your connection. Change it if it isn&apos;t right.</p>}
        {error && <p role="alert" style={{ margin: "0.6rem 0 0", color: T.danger, fontSize: "0.85rem" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: "1.3rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => void save()} disabled={busy} style={{ flex: "1 1 160px", background: T.action, color: T.onAction, border: 0, borderRadius: T.radius, padding: "0.85rem 1.2rem", fontWeight: 800, fontSize: "0.95rem", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: T.font }}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
