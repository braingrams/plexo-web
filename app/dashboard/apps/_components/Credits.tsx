"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Loader2, X } from "lucide-react";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { C } from "./ui";

// AI credits in the app editor: a meter that's always visible, a panel to top up before you
// run out, a card in the chat when you have, and a checkout that finishes in place — the
// owner never leaves their app. Credits are added by the Stripe webhook, so after paying we
// watch the balance until they land.

export type PackId = "SMALL" | "MEDIUM" | "LARGE";
export type Pack = { pack: PackId; credits: number; price: string | null };

/** Running low: under a fifth of what the plan grants each month. */
export const isLow = (credits: number, monthly: number | null) => credits < Math.max(10, (monthly ?? 0) * 0.2);
const n = (v: number) => v.toLocaleString("en-US");

export function useCredits() {
  const [credits, setCredits] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const refresh = useCallback(async (): Promise<number | null> => {
    try {
      const res = await fetch("/api/v1/profile", { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      const total = typeof data?.user?.totalCredits === "number" ? data.user.totalCredits : null;
      setCredits(total);
      if (typeof data?.user?.monthlyCredits === "number") setMonthly(data.user.monthlyCredits);
      return total;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { credits, monthly, setCredits, refresh };
}

/** The packs with their real prices and credits (half the price as AI value — lib/credits/value.ts). */
export function usePacks(enabled: boolean) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/billing/topup-packs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && Array.isArray(d?.packs) && setPacks(d.packs))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return packs;
}

function Bar({ credits, monthly, height = 6 }: { credits: number; monthly: number | null; height?: number }) {
  // Full = the plan's monthly amount; top-ups beyond it still read as full.
  const pct = Math.max(credits > 0 ? 4 : 0, Math.min(100, (credits / Math.max(1, monthly ?? credits)) * 100));
  return (
    <span style={{ display: "block", width: "100%", height, borderRadius: 99, background: "rgba(255,255,255,0.1)" }}>
      <span style={{ display: "block", width: `${pct}%`, height: "100%", borderRadius: 99, background: isLow(credits, monthly) ? C.warning : C.text }} />
    </span>
  );
}

/** The top-bar meter. Opens the credits panel. */
export function CreditsMeter({ credits, monthly, open, onToggle }: { credits: number | null; monthly: number | null; open: boolean; onToggle: () => void }) {
  const low = credits !== null && isLow(credits, monthly);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={credits === null ? "AI credits" : `${n(credits)} AI credits left`}
      style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "0.38rem 0.7rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", color: C.text, background: "transparent", border: `1px solid ${low ? C.warning : C.border}` }}
    >
      <span style={{ width: 54 }}>{credits !== null && <Bar credits={credits} monthly={monthly} />}</span>
      <span style={{ fontSize: "0.76rem", fontWeight: 600, whiteSpace: "nowrap", color: low ? C.warning : C.text }}>
        {credits === null ? "Credits" : credits <= 0 ? "No credits left" : `${n(credits)} credits left`}
      </span>
    </button>
  );
}

function PackRow({ pack, highlight, onPick }: { pack: Pack; highlight?: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "0.7rem 0.75rem", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: C.text, background: highlight ? "rgba(255,255,255,0.04)" : "transparent", border: highlight ? `2px solid ${C.text}` : `1px solid ${C.border}` }}
    >
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: "0.86rem", fontWeight: 700 }}>
          {n(pack.credits)} credits
          {highlight && <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 99, background: "rgba(255,255,255,0.08)", fontSize: "0.68rem", fontWeight: 600 }}>Most popular</span>}
        </span>
      </span>
      <span style={{ padding: "0.35rem 0.7rem", borderRadius: 9, background: C.text, color: C.bg, fontSize: "0.76rem", fontWeight: 700 }}>{pack.price ?? "Buy"}</span>
    </button>
  );
}

/** The panel under the meter: balance, a plain-words note, and the packs. */
export function CreditsPanel({ credits, monthly, onPick, onClose }: { credits: number | null; monthly: number | null; onPick: (pack: Pack) => void; onClose: () => void }) {
  const packs = usePacks(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const low = credits !== null && isLow(credits, monthly);
  return (
    <div ref={ref} role="dialog" aria-label="AI credits" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 360, zIndex: 80, padding: "1rem", borderRadius: 16, background: C.panelSolid, border: `1px solid ${C.borderStrong}`, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: "clamp(1.25rem, 4.8vw, 1.6rem)", fontWeight: 800 }}>{credits === null ? "—" : n(Math.max(0, credits))}</span>
        <span style={{ fontSize: "0.76rem", color: C.muted }}>AI credits left</span>
      </div>
      {credits !== null && <Bar credits={credits} monthly={monthly} height={8} />}
      {monthly !== null && <div style={{ fontSize: "0.74rem", color: C.faint }}>Your plan adds {n(monthly)} credits each month.</div>}
      <div style={{ padding: "0.6rem 0.75rem", borderRadius: 10, background: "rgba(255,255,255,0.05)", fontSize: "0.8rem", lineHeight: 1.5, color: low ? C.warning : C.muted }}>
        {low ? "Running low. Top up so SOL doesn't stop in the middle of a change." : "SOL uses credits when it changes your app. Editing the code yourself is free."}
      </div>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>Top up</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {packs === null ? <div style={{ fontSize: "0.8rem", color: C.muted }}>Loading prices…</div> : packs.length === 0 ? <div style={{ fontSize: "0.8rem", color: C.muted }}>Top-ups aren&rsquo;t available right now.</div> : packs.map((p) => <PackRow key={p.pack} pack={p} highlight={p.pack === "MEDIUM"} onPick={() => onPick(p)} />)}
      </div>
      <a href="/dashboard/settings/subscription" style={{ fontSize: "0.8rem", color: C.brand, textDecoration: "none" }}>Upgrade your plan for more each month →</a>
    </div>
  );
}

/** Shown above the chat box when a message couldn't be sent for lack of credits. */
export function OutOfCreditsCard({ midTurn, onPick, onDismiss, onOpenCode }: { midTurn?: boolean; onPick: (pack: Pack) => void; onDismiss: () => void; onOpenCode?: () => void }) {
  const packs = usePacks(true);
  const [chosen, setChosen] = useState<PackId>("MEDIUM");
  const pack = packs?.find((p) => p.pack === chosen) ?? packs?.[0] ?? null;
  return (
    <div style={{ marginBottom: 8, padding: "0.9rem", borderRadius: 14, border: `1.5px solid ${C.text}`, background: C.panelSolid, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 800 }}>{midTurn ? "SOL ran out of credits partway through" : "You’ve used all your AI credits"}</div>
          <div style={{ fontSize: "0.78rem", color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
            {midTurn ? "Everything it built so far is saved. Top up and SOL carries on from where it stopped." : "Top up to keep going. Your message is kept and SOL carries on as soon as you’re done."}
          </div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
          <X size={15} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {(packs ?? []).map((p) => (
          <button key={p.pack} type="button" onClick={() => setChosen(p.pack)} aria-pressed={p.pack === chosen} style={{ padding: "0.55rem 0.3rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", color: C.text, textAlign: "center", background: p.pack === chosen ? "rgba(255,255,255,0.06)" : "transparent", border: p.pack === chosen ? `2px solid ${C.text}` : `1px solid ${C.border}` }}>
            <span style={{ display: "block", fontSize: "0.82rem", fontWeight: 700 }}>{n(p.credits)}</span>
            <span style={{ display: "block", fontSize: "0.7rem", color: C.muted }}>{p.price ?? "credits"}</span>
          </button>
        ))}
      </div>
      <button type="button" disabled={!pack} onClick={() => pack && onPick(pack)} style={{ padding: "0.7rem", borderRadius: 11, border: "none", cursor: pack ? "pointer" : "default", fontFamily: "inherit", fontSize: "0.86rem", fontWeight: 700, background: C.text, color: C.bg, opacity: pack ? 1 : 0.6 }}>
        {pack ? `Add ${n(pack.credits)} credits${pack.price ? ` · ${pack.price}` : ""}` : "Loading prices…"}
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem" }}>
        <a href="/dashboard/settings/subscription" style={{ color: C.brand, textDecoration: "none" }}>Upgrade plan instead</a>
        {onOpenCode && <button type="button" onClick={onOpenCode} style={{ background: "none", border: "none", padding: 0, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: "0.76rem" }}>Editing code is still free →</button>}
      </div>
    </div>
  );
}

/** The in-place checkout: a side panel over the app. Finishes without leaving the editor. */
export function TopUpSheet({ pack, returnTo, startingCredits, onDone, onClose }: { pack: Pack; returnTo: string; startingCredits: number | null; onDone: (credits: number | null) => void; onClose: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "paying" | "adding" | "slow">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "topup", pack: pack.pack, returnTo, stayInPage: true }) })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { clientSecret?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.clientSecret) throw new Error(data.error ?? "We couldn't open the payment form.");
        setSecret(data.clientSecret);
        setPhase("paying");
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "We couldn't open the payment form."));
    return () => {
      cancelled = true;
    };
  }, [pack.pack, returnTo]);

  // Paid → the webhook adds the credits within a few seconds; watch for them.
  const onComplete = useCallback(() => {
    setPhase("adding");
    const before = startingCredits ?? 0;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const res = await fetch("/api/v1/profile", { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        const total = data?.user?.totalCredits;
        if (typeof total === "number" && total > before) return onDone(total);
      } catch {
        // keep trying
      }
      if (tries < 20) setTimeout(() => void tick(), 1500);
      else setPhase("slow");
    };
    void tick();
  }, [startingCredits, onDone]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Add ${n(pack.credits)} credits`} style={{ position: "fixed", top: 52, right: 0, bottom: 0, width: "min(480px, 100vw)", zIndex: 90, background: C.panelSolid, borderLeft: `1px solid ${C.borderStrong}`, boxShadow: "-24px 0 60px -20px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ flex: 1, fontWeight: 800 }}>Add {n(pack.credits)} credits</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
          <X size={17} />
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "1rem 1.1rem 0", padding: "0.7rem 0.85rem", borderRadius: 12, background: "rgba(255,255,255,0.05)", fontSize: "0.86rem" }}>
        <span>{n(pack.credits)} AI credits</span>
        <strong>{pack.price ?? ""}</strong>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "1rem 1.1rem", borderRadius: 14, background: "#fff" }}>
        {error ? (
          <div style={{ padding: "1.2rem", color: "#b91c1c", fontSize: "0.86rem" }}>{error}</div>
        ) : phase === "adding" || phase === "slow" ? (
          <div style={{ height: "100%", minHeight: 240, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "1.5rem", textAlign: "center", color: "#1c1c22" }}>
            {phase === "adding" ? <Loader2 size={22} className="credits-spin" /> : null}
            <div style={{ fontWeight: 700 }}>{phase === "adding" ? "Payment done — adding your credits…" : "Payment done"}</div>
            {phase === "slow" && <div style={{ fontSize: "0.84rem", color: "#5b5b66" }}>Your credits are on their way and will appear in a minute. You can close this.</div>}
          </div>
        ) : secret ? (
          <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: secret, onComplete }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        ) : (
          <div style={{ height: "100%", minHeight: 240, display: "grid", placeItems: "center", color: "#5b5b66" }}>
            <Loader2 size={22} className="credits-spin" />
          </div>
        )}
      </div>
      <div style={{ padding: "0 1.1rem 1rem", fontSize: "0.76rem", color: C.muted, textAlign: "center" }}>Credits arrive straight away. You stay in your app.</div>
      <style>{`.credits-spin { animation: credits-spin 0.9s linear infinite; } @keyframes credits-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
